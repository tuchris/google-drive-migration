/**
 * ============================================================
 * FAST GOOGLE DRIVE -> WORKSPACE SHARED DRIVE MIGRATION
 * ============================================================
 *
 * Drive API v3 / Google Apps Script
 *
 * SOURCE:
 *   Folder in a personal Google account
 *
 * DESTINATION:
 *   Workspace Shared Drive
 *
 * FEATURES:
 *   - Recursive folder structure
 *   - Native Google Docs / Sheets / Slides preserved
 *   - Direct server-side copies
 *   - Parallel file copying
 *   - Batch logging
 *   - Automatic continuation
 *   - Restart-safe
 *   - Failed-file-only retry
 *   - Source modifiedTime preserved
 *   - No local downloads
 *
 * IMPORTANT:
 *   Run this project while authenticated as the
 *   Workspace account.
 */



const FOLDER_MIME_TYPE =
  'application/vnd.google-apps.folder';


/* ============================================================
   LIST SHARED DRIVES
   ============================================================ */

function listSharedDrives() {

  const response =
    withRetry(
      () =>
        Drive.Drives.list({
          pageSize:
            100,
          fields:
            'drives(id,name)'
        }),

      'Listing Shared Drives'
    );


  const drives =
    response.drives || [];


  if (!drives.length) {

    Logger.log(
      'No Shared Drives available.'
    );

    return;
  }


  drives.forEach(
    drive => {

      Logger.log(
        'NAME: %s | ID: %s',
        drive.name,
        drive.id
      );
    }
  );
}



/* ============================================================
   TEST CONFIGURATION
   ============================================================ */

function testConfiguration() {

  validateConfiguration();


  const source =
    withRetry(
      () =>
        Drive.Files.get(
          CONFIG.SOURCE_FOLDER_ID,
          {
            fields:
              'id,name,mimeType,modifiedTime,trashed'
          }
        ),

      'Testing source'
    );


  if (
    source.mimeType !==
    FOLDER_MIME_TYPE
  ) {

    throw new Error(
      'SOURCE_FOLDER_ID is not a folder.'
    );
  }


  const drive =
    withRetry(
      () =>
        Drive.Drives.get(
          CONFIG.DESTINATION_SHARED_DRIVE_ID,
          {
            fields:
              'id,name'
          }
        ),

      'Testing destination Shared Drive'
    );


  const destinationContents =
    withRetry(
      () =>
        Drive.Files.list({

          q:
            "'" +
            drive.id +
            "' in parents and trashed = false",

          corpora:
            'drive',

          driveId:
            drive.id,

          includeItemsFromAllDrives:
            true,

          supportsAllDrives:
            true,

          pageSize:
            10,

          fields:
            'files(id,name,mimeType)'

        }),

      'Testing Shared Drive access'
    );


  Logger.log(
    '===================================================='
  );

  Logger.log(
    'CONFIGURATION TEST PASSED'
  );

  Logger.log(
    'Source folder: %s',
    source.name
  );

  Logger.log(
    'Source ID: %s',
    source.id
  );

  Logger.log(
    'Destination Shared Drive: %s',
    drive.name
  );

  Logger.log(
    'Destination ID: %s',
    drive.id
  );

  Logger.log(
    'Items visible at Shared Drive root: %s',
    (destinationContents.files || []).length
  );

  Logger.log(
    '===================================================='
  );
}

/* ============================================================
   MAIN ENTRY POINT
   ============================================================ */

function runMigration() {

  const lock =
    LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    Logger.log(
      'Another migration execution is already running.'
    );
    return;
  }

  const startTime =
    Date.now();

  try {

    validateConfiguration();

    initializeMigration();

    /*
     * --------------------------------------------------------
     * Build destination index ONCE.
     *
     * This is the major performance improvement over the
     * previous version.
     * --------------------------------------------------------
     */

    const destinationIndex =
      buildDestinationIndex();


    /*
     * --------------------------------------------------------
     * Verify source.
     * --------------------------------------------------------
     */

    const sourceRoot =
      withRetry(
        () => Drive.Files.get(
          CONFIG.SOURCE_FOLDER_ID,
          {
            supportsAllDrives: true,

            fields:
              'id,name,mimeType,modifiedTime,trashed'
          }
        ),
        'Reading source folder'
      );


    if (
      sourceRoot.mimeType !==
      FOLDER_MIME_TYPE
    ) {
      throw new Error(
        'SOURCE_FOLDER_ID is not a folder.'
      );
    }


    if (sourceRoot.trashed) {
      throw new Error(
        'Source folder is in the Trash.'
      );
    }


    /*
     * --------------------------------------------------------
     * Verify Shared Drive.
     * --------------------------------------------------------
     */

    const destinationDrive =
      withRetry(
        () => Drive.Drives.get(
          CONFIG.DESTINATION_SHARED_DRIVE_ID,
          {
            fields:
              'id,name'
          }
        ),
        'Reading destination Shared Drive'
      );


    Logger.log(
      '===================================================='
    );

    Logger.log(
      'FAST MIGRATION STARTED'
    );

    Logger.log(
      'Source: %s',
      sourceRoot.name
    );

    Logger.log(
      'Destination: %s',
      destinationDrive.name
    );

    Logger.log(
      'Parallel copies: %s',
      CONFIG.CONCURRENT_COPIES
    );

    Logger.log(
      'Existing migration items indexed: %s',
      destinationIndex.size
    );

    Logger.log(
      '===================================================='
    );


    /*
     * --------------------------------------------------------
     * Create/find top-level destination folder.
     * --------------------------------------------------------
     */

    const rootKey =
      makeMigrationKey(
        sourceRoot.id,
        CONFIG.DESTINATION_SHARED_DRIVE_ID
      );


    let destinationRoot =
      destinationIndex.get(rootKey);


    if (!destinationRoot) {

      destinationRoot =
        createDestinationFolder(
          sourceRoot.name,
          CONFIG.DESTINATION_SHARED_DRIVE_ID,
          sourceRoot.id,
          sourceRoot.modifiedTime
        );


      destinationIndex.set(
        rootKey,
        destinationRoot
      );

    }


    /*
     * --------------------------------------------------------
     * Recursively process everything.
     * --------------------------------------------------------
     */

    const completed =
      processFolder(
        sourceRoot.id,
        destinationRoot.id,
        sourceRoot.name,
        sourceRoot.modifiedTime,
        destinationIndex,
        startTime
      );


    if (completed) {

      setStatus('COMPLETED');

      removeContinuationTriggers();

      flushLog();

      logSystem(
        'COMPLETED',
        getStatsSummary()
      );


      Logger.log(
        '===================================================='
      );

      Logger.log(
        'MIGRATION COMPLETED'
      );

      Logger.log(
        getStatsSummary()
      );

      Logger.log(
        'Migration log: %s',
        getLogSpreadsheetUrl()
      );

      Logger.log(
        '===================================================='
      );


    } else {

      setStatus('PAUSED');

      flushLog();

      scheduleContinuation();

      logSystem(
        'PAUSED',
        getStatsSummary()
      );


      Logger.log(
        '===================================================='
      );

      Logger.log(
        'EXECUTION LIMIT REACHED'
      );

      Logger.log(
        'Continuation scheduled automatically.'
      );

      Logger.log(
        getStatsSummary()
      );

      Logger.log(
        '===================================================='
      );
    }


  } catch (error) {

    flushLog();

    setStatus('ERROR');

    logSystem(
      'ERROR',
      errorMessage(error)
    );

    Logger.log(
      'MIGRATION ERROR: %s',
      errorMessage(error)
    );

    throw error;


  } finally {

    lock.releaseLock();
  }
}


/* ============================================================
   PROCESS FOLDER
   ============================================================ */

function processFolder(
  sourceFolderId,
  destinationFolderId,
  path,
  sourceModifiedTime,
  destinationIndex,
  startTime
) {

  let pageToken =
    null;


  do {

    if (
      timeLimitReached(startTime)
    ) {

      return false;
    }


    const response =
      withRetry(
        () =>
          Drive.Files.list({

            q:
              "'" +
              sourceFolderId +
              "' in parents and trashed = false",

            pageSize:
              1000,

            pageToken:
              pageToken,

            orderBy:
              'folder,name',

            spaces:
              'drive',

            fields:
              'nextPageToken,' +
              'files(' +
              'id,' +
              'name,' +
              'mimeType,' +
              'modifiedTime,' +
              'size,' +
              'webViewLink' +
              ')'

          }),

        'Listing folder: ' + path
      );


    const files =
      response.files || [];


    let copyQueue = [];


    for (
      let i = 0;
      i < files.length;
      i++
    ) {

      if (
        timeLimitReached(startTime)
      ) {

        if (copyQueue.length) {
          copyQueue = flushCopyQueue(
            copyQueue,
            destinationIndex
          );
        }

        flushLog();

        return false;
      }


      const item =
        files[i];


      const currentPath =
        path +
        '/' +
        item.name;


      /*
       * ======================================================
       * FOLDER
       * ======================================================
       */

      if (
        item.mimeType ===
        FOLDER_MIME_TYPE
      ) {

        const folderKey =
          makeMigrationKey(
            item.id,
            destinationFolderId
          );


        let destinationFolder =
          destinationIndex.get(
            folderKey
          );


        if (!destinationFolder) {

          destinationFolder =
            createDestinationFolder(
              item.name,
              destinationFolderId,
              item.id,
              item.modifiedTime
            );


          destinationIndex.set(
            folderKey,
            destinationFolder
          );

        }


        incrementStat(
          'folders'
        );


        /*
         * Process this folder before continuing.
         */

        if (copyQueue.length) {

          copyQueue =
            flushCopyQueue(
              copyQueue,
              destinationIndex
            );
        }


        Logger.log(
          '[FOLDER] %s',
          currentPath
        );


        const completed =
          processFolder(
            item.id,
            destinationFolder.id,
            currentPath,
            item.modifiedTime,
            destinationIndex,
            startTime
          );


        if (!completed) {
          return false;
        }


        continue;
      }


      /*
       * ======================================================
       * FILE
       * ======================================================
       */

      const migrationKey =
        makeMigrationKey(
          item.id,
          destinationFolderId
        );


      /*
       * Already copied?
       */

      if (
        destinationIndex.has(
          migrationKey
        )
      ) {

        incrementStat(
          'skipped'
        );

        incrementStat(
          'processed'
        );


        queueLog(
          [
            new Date(),
            'FILE',
            item.id,
            currentPath,
            'SKIPPED',
            'Already copied',
            destinationIndex.get(
              migrationKey
            ).id,
            destinationFolderId,
            item.modifiedTime
          ]
        );


        continue;
      }


      /*
       * Queue the copy.
       */

      copyQueue.push({
        sourceId:
          item.id,

        name:
          item.name,

        mimeType:
          item.mimeType,

        modifiedTime:
          item.modifiedTime,

        destinationParentId:
          destinationFolderId,

        path:
          currentPath,

        migrationKey:
          migrationKey
      });


      /*
       * Flush when queue reaches concurrency size.
       */

      if (
        copyQueue.length >=
        CONFIG.CONCURRENT_COPIES
      ) {

        copyQueue =
          flushCopyQueue(
            copyQueue,
            destinationIndex
          );


        if (
          getStats().processed %
          CONFIG.PROGRESS_EVERY ===
          0
        ) {

          Logger.log(
            '[PROGRESS] %s',
            getStatsSummary()
          );

          flushLog();
        }


        if (
          timeLimitReached(
            startTime
          )
        ) {

          flushLog();

          return false;
        }
      }
    }


    /*
     * Flush remaining files from this page.
     */

    if (copyQueue.length) {

      copyQueue =
        flushCopyQueue(
          copyQueue,
          destinationIndex
        );
    }


    pageToken =
      response.nextPageToken;


  } while (pageToken);


  return true;
}


/* ============================================================
   PARALLEL COPY QUEUE
   ============================================================ */

function flushCopyQueue(
  queue,
  destinationIndex
) {

  if (!queue.length) {
    return [];
  }


  /*
   * We use fetchAll() so several copy operations can be
   * in-flight at the same time.
   */

  const token =
    ScriptApp.getOAuthToken();


  const requests =
    queue.map(
      task => {

        const url =
          'https://www.googleapis.com/drive/v3/files/' +
          encodeURIComponent(
            task.sourceId
          ) +
          '/copy' +
          '?supportsAllDrives=true' +
          '&fields=id,name,mimeType,modifiedTime,webViewLink,appProperties';


        const body = {

          name:
            task.name,

          parents:
            [
              task.destinationParentId
            ],

          /*
           * This makes restart detection possible without
           * searching by filename.
           */

          appProperties:
            {
              migrationKey:
                task.migrationKey,

              migrationSourceId:
                task.sourceId,

              migrationSourceModifiedTime:
                task.modifiedTime || ''
            },

          /*
           * Explicitly preserve Drive's modifiedTime.
           */

          modifiedTime:
            task.modifiedTime

        };


        return {

          url:
            url,

          method:
            'post',

          contentType:
            'application/json',

          payload:
            JSON.stringify(
              body
            ),

          headers:
            {
              Authorization:
                'Bearer ' + token
            },

          muteHttpExceptions:
            true
        };
      }
    );


  const responses =
    UrlFetchApp.fetchAll(
      requests
    );


  /*
   * ----------------------------------------------------------
   * Handle first batch of responses.
   * ----------------------------------------------------------
   */

  const failedTasks = [];


  for (
    let i = 0;
    i < queue.length;
    i++
  ) {

    const task =
      queue[i];

    const response =
      responses[i];


    const code =
      response.getResponseCode();


    if (
      code >= 200 &&
      code < 300
    ) {

      const result =
        JSON.parse(
          response.getContentText()
        );


      destinationIndex.set(
        task.migrationKey,
        {
          id:
            result.id,

          name:
            result.name,

          mimeType:
            result.mimeType,

          modifiedTime:
            result.modifiedTime
        }
      );


      incrementStat(
        'copied'
      );

      incrementStat(
        'processed'
      );


      queueLog(
        [
          new Date(),
          'FILE',
          task.sourceId,
          task.path,
          'COPIED',
          '',
          result.id,
          task.destinationParentId,
          task.modifiedTime
        ]
      );


      Logger.log(
        '[COPIED] %s',
        task.path
      );


    } else {

      failedTasks.push({
        task:
          task,

        code:
          code,

        body:
          response.getContentText()
      });
    }
  }


  /*
   * ----------------------------------------------------------
   * Retry failed individual requests.
   * ----------------------------------------------------------
   */

  for (
    let i = 0;
    i < failedTasks.length;
    i++
  ) {

    const failure =
      failedTasks[i];


    const result =
      retrySingleCopy(
        failure.task,
        failure.code,
        failure.body
      );


    if (result.success) {

      destinationIndex.set(
        failure.task.migrationKey,
        result.file
      );


      incrementStat(
        'copied'
      );

      incrementStat(
        'processed'
      );


      queueLog(
        [
          new Date(),
          'FILE',
          failure.task.sourceId,
          failure.task.path,
          'COPIED',
          'Succeeded after retry',
          result.file.id,
          failure.task.destinationParentId,
          failure.task.modifiedTime
        ]
      );


    } else {

      incrementStat(
        'failed'
      );

      incrementStat(
        'processed'
      );


      queueLog(
        [
          new Date(),
          'FILE',
          failure.task.sourceId,
          failure.task.path,
          'FAILED',
          result.message,
          '',
          failure.task.destinationParentId,
          failure.task.modifiedTime
        ]
      );


      Logger.log(
        '[FAILED] %s — %s',
        failure.task.path,
        result.message
      );
    }
  }


  flushLog();


  return [];
}


/* ============================================================
   RETRY ONE FAILED COPY
   ============================================================ */

function retrySingleCopy(
  task,
  initialCode,
  initialBody
) {

  let lastMessage =
    formatHttpError(
      initialCode,
      initialBody
    );


  /*
   * Do not retry permanent errors such as permission errors
   * unless they are clearly quota/rate-limit related.
   */

  if (
    !isRetryableHttpError(
      initialCode,
      initialBody
    )
  ) {

    return {
      success:
        false,

      message:
        lastMessage
    };
  }


  for (
    let attempt = 1;
    attempt <= CONFIG.MAX_RETRIES;
    attempt++
  ) {

    const delay =
      CONFIG.RETRY_BASE_DELAY_MS *
      Math.pow(
        2,
        attempt - 1
      ) +
      Math.floor(
        Math.random() * 500
      );


    Logger.log(
      '[COPY RETRY %s/%s] %s',
      attempt,
      CONFIG.MAX_RETRIES,
      task.path
    );


    Utilities.sleep(
      delay
    );


    const token =
      ScriptApp.getOAuthToken();


    const url =
      'https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(
        task.sourceId
      ) +
      '/copy' +
      '?supportsAllDrives=true' +
      '&fields=id,name,mimeType,modifiedTime,webViewLink,appProperties';


    const body = {

      name:
        task.name,

      parents:
        [
          task.destinationParentId
        ],

      appProperties:
        {
          migrationKey:
            task.migrationKey,

          migrationSourceId:
            task.sourceId,

          migrationSourceModifiedTime:
            task.modifiedTime || ''
        },

      modifiedTime:
        task.modifiedTime
    };


    const response =
      UrlFetchApp.fetch(
        url,
        {

          method:
            'post',

          contentType:
            'application/json',

          payload:
            JSON.stringify(
              body
            ),

          headers:
            {
              Authorization:
                'Bearer ' + token
            },

          muteHttpExceptions:
            true

        }
      );


    const code =
      response.getResponseCode();


    const responseBody =
      response.getContentText();


    if (
      code >= 200 &&
      code < 300
    ) {

      return {
        success:
          true,

        file:
          JSON.parse(
            responseBody
          )
      };
    }


    lastMessage =
      formatHttpError(
        code,
        responseBody
      );


    if (
      !isRetryableHttpError(
        code,
        responseBody
      )
    ) {

      break;
    }
  }


  return {
    success:
      false,

    message:
      lastMessage
  };
}


/* ============================================================
   CREATE DESTINATION FOLDER
   ============================================================ */

function createDestinationFolder(
  name,
  parentId,
  sourceId,
  sourceModifiedTime
) {

  const migrationKey =
    makeMigrationKey(
      sourceId,
      parentId
    );


  const folder =
    withRetry(
      () =>
        Drive.Files.create(
          {

            name:
              name,

            mimeType:
              FOLDER_MIME_TYPE,

            parents:
              [
                parentId
              ],

            appProperties:
              {

                migrationKey:
                  migrationKey,

                migrationSourceId:
                  sourceId,

                migrationSourceModifiedTime:
                  sourceModifiedTime || ''
              },

            modifiedTime:
              sourceModifiedTime

          },

          null,

          {

            supportsAllDrives:
              true,

            fields:
              'id,name,mimeType,modifiedTime,appProperties'

          }
        ),

      'Creating folder: ' + name
    );


  queueLog(
    [
      new Date(),
      'FOLDER',
      sourceId,
      name,
      'CREATED',
      '',
      folder.id,
      parentId,
      sourceModifiedTime || ''
    ]
  );


  incrementStat(
    'folders'
  );


  return folder;
}


/* ============================================================
   BUILD DESTINATION INDEX
   ============================================================ */

/**
 * Builds a map of all objects previously created by THIS
 * migration.
 *
 * Crucially, it does NOT list every unrelated file in the
 * Shared Drive.
 */
function buildDestinationIndex() {

  const index = new Map();

  let pageToken = null;

  do {

    const response = withRetry(
      () => Drive.Files.list({

        /*
         * We intentionally don't filter by appProperties here.
         * We retrieve the files in our Shared Drive and filter
         * locally for our migration marker.
         *
         * This avoids the Drive API query limitation around
         * searching for "any value" of an appProperty.
         */
        q:
          "trashed = false",

        corpora:
          'drive',

        driveId:
          CONFIG.DESTINATION_SHARED_DRIVE_ID,

        includeItemsFromAllDrives:
          true,

        supportsAllDrives:
          true,

        pageSize:
          1000,

        pageToken:
          pageToken,

        fields:
          'nextPageToken,' +
          'files(' +
          'id,' +
          'name,' +
          'mimeType,' +
          'modifiedTime,' +
          'appProperties' +
          ')'

      }),

      'Indexing destination Shared Drive'
    );


    const files =
      response.files || [];


    files.forEach(file => {

      if (
        file.appProperties &&
        file.appProperties.migrationKey
      ) {

        index.set(
          file.appProperties.migrationKey,
          file
        );
      }
    });


    pageToken =
      response.nextPageToken;

  } while (pageToken);


  Logger.log(
    'Destination migration index contains %s items.',
    index.size
  );


  return index;
}


/* ============================================================
   FAILED-ONLY RETRY
   ============================================================ */

/**
 * Retries only items whose LATEST logged status is FAILED.
 *
 * Run this after the main migration has completed.
 */
function retryFailedFiles() {

  const lock =
    LockService.getScriptLock();


  if (!lock.tryLock(1000)) {

    Logger.log(
      'Another migration execution is already running.'
    );

    return;
  }


  try {

    const failedItems =
      getLatestFailedItems();


    if (
      failedItems.length === 0
    ) {

      Logger.log(
        'No currently failed items.'
      );

      return;
    }


    Logger.log(
      '===================================================='
    );

    Logger.log(
      'RETRY FAILED FILES'
    );

    Logger.log(
      'Items: %s',
      failedItems.length
    );

    Logger.log(
      '===================================================='
    );


    const destinationIndex =
      buildDestinationIndex();


    /*
     * Retry folders first.
     */

    const folders =
      failedItems.filter(
        item =>
          item.type === 'FOLDER'
      );


    folders.forEach(
      item => {

        const key =
          makeMigrationKey(
            item.sourceId,
            item.destinationParentId
          );


        if (
          destinationIndex.has(key)
        ) {
          return;
        }


        try {

          const source =
            Drive.Files.get(
              item.sourceId,
              {
                supportsAllDrives: true,

                fields:
                  'id,name,mimeType,modifiedTime,trashed'
              }
            );


          if (source.trashed) {

            throw new Error(
              'Source folder is in Trash.'
            );
          }


          const folder =
            createDestinationFolder(
              source.name,
              item.destinationParentId,
              source.id,
              source.modifiedTime
            );


          destinationIndex.set(
            key,
            folder
          );


        } catch (error) {

          queueLog(
            [
              new Date(),
              'FOLDER',
              item.sourceId,
              item.path,
              'FAILED',
              errorMessage(error),
              '',
              item.destinationParentId,
              ''
            ]
          );
        }
      }
    );


    /*
     * Retry files in parallel batches.
     */

    let queue = [];


    failedItems
      .filter(
        item =>
          item.type === 'FILE'
      )
      .forEach(
        item => {

          const key =
            makeMigrationKey(
              item.sourceId,
              item.destinationParentId
            );


          if (
            destinationIndex.has(key)
          ) {

            return;
          }


          try {

            const source =
              Drive.Files.get(
                item.sourceId,
                {
                  fields:
                    'id,name,mimeType,modifiedTime,trashed'
                }
              );


            if (source.trashed) {

              throw new Error(
                'Source file is in Trash.'
              );
            }


            queue.push({

              sourceId:
                source.id,

              name:
                source.name,

              mimeType:
                source.mimeType,

              modifiedTime:
                source.modifiedTime,

              destinationParentId:
                item.destinationParentId,

              path:
                item.path,

              migrationKey:
                key
            });


            if (
              queue.length >=
              CONFIG.CONCURRENT_COPIES
            ) {

              queue =
                flushCopyQueue(
                  queue,
                  destinationIndex
                );
            }


          } catch (error) {

            queueLog(
              [
                new Date(),
                'FILE',
                item.sourceId,
                item.path,
                'FAILED',
                errorMessage(error),
                '',
                item.destinationParentId,
                ''
              ]
            );
          }
        }
      );


    if (queue.length) {

      flushCopyQueue(
        queue,
        destinationIndex
      );
    }


    flushLog();


    Logger.log(
      'Retry finished.'
    );

    Logger.log(
      getStatsSummary()
    );


  } finally {

    lock.releaseLock();
  }
}


/* ============================================================
   GET CURRENTLY FAILED ITEMS
   ============================================================ */

function getLatestFailedItems() {

  const sheet =
    getLogSheet();


  const values =
    sheet
      .getDataRange()
      .getValues();


  const latest =
    new Map();


  /*
   * Columns:
   *
   * 0 Timestamp
   * 1 Type
   * 2 Source ID
   * 3 Path
   * 4 Status
   * 5 Message
   * 6 Destination ID
   * 7 Destination Parent ID
   * 8 Source Modified Time
   */


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    const row =
      values[i];


    const type =
      row[1];

    const sourceId =
      row[2];

    const destinationParentId =
      row[7];


    if (
      !sourceId
    ) {
      continue;
    }


    const key =
      type +
      '|' +
      sourceId +
      '|' +
      destinationParentId;


    latest.set(
      key,
      {

        type:
          type,

        sourceId:
          sourceId,

        path:
          row[3],

        status:
          row[4],

        message:
          row[5],

        destinationParentId:
          destinationParentId

      }
    );
  }


  return Array.from(
    latest.values()
  )
    .filter(
      item =>
        item.status ===
        'FAILED'
    );
}






/* ============================================================
   STATUS
   ============================================================ */

function showMigrationStatus() {

  Logger.log(
    'STATUS: %s',

    PropertiesService
      .getScriptProperties()
      .getProperty(
        CONFIG.PROPERTY_STATUS
      ) ||

      'NOT STARTED'
  );


  Logger.log(
    getStatsSummary()
  );


  Logger.log(
    'LOG: %s',
    getLogSpreadsheetUrl()
  );
}


/* ============================================================
   RESET STATE
   ============================================================ */

function resetMigrationState() {

  removeContinuationTriggers();


  const props =
    PropertiesService
      .getScriptProperties();


  props.deleteProperty(
    CONFIG.PROPERTY_STATUS
  );


  props.deleteProperty(
    CONFIG.PROPERTY_STATS
  );


  Logger.log(
    'Migration state reset.'
  );


  Logger.log(
    'Nothing was deleted from the destination.'
  );


  Logger.log(
    'Already-copied files will still be detected.'
  );
}


/* ============================================================
   RETRY / HTTP HELPERS
   ============================================================ */

function withRetry(
  operation,
  description
) {

  let lastError =
    null;


  for (
    let attempt = 1;
    attempt <= CONFIG.MAX_RETRIES;
    attempt++
  ) {

    try {

      return operation();

    } catch (error) {

      lastError =
        error;


      if (
        !isRetryableException(
          error
        ) ||
        attempt ===
        CONFIG.MAX_RETRIES
      ) {

        throw error;
      }


      const delay =
        CONFIG.RETRY_BASE_DELAY_MS *
        Math.pow(
          2,
          attempt - 1
        ) +
        Math.floor(
          Math.random() * 500
        );


      Logger.log(
        '[RETRY %s/%s] %s',
        attempt,
        CONFIG.MAX_RETRIES,
        description
      );


      Utilities.sleep(
        delay
      );
    }
  }


  throw lastError;
}


function isRetryableException(
  error
) {

  const message =
    errorMessage(
      error
    ).toLowerCase();


  return (
    message.indexOf('429') !== -1 ||
    message.indexOf('500') !== -1 ||
    message.indexOf('502') !== -1 ||
    message.indexOf('503') !== -1 ||
    message.indexOf('504') !== -1 ||
    message.indexOf('rate limit') !== -1 ||
    message.indexOf('ratelimit') !== -1 ||
    message.indexOf('quota exceeded') !== -1 ||
    message.indexOf('backend error') !== -1 ||
    message.indexOf('temporarily unavailable') !== -1
  );
}


function isRetryableHttpError(
  code,
  body
) {

  if (
    code === 429 ||
    code === 500 ||
    code === 502 ||
    code === 503 ||
    code === 504
  ) {

    return true;
  }


  if (
    code !== 403
  ) {

    return false;
  }


  const text =
    String(
      body || ''
    ).toLowerCase();


  return (
    text.indexOf(
      'userRateLimitExceeded'
        .toLowerCase()
    ) !== -1 ||

    text.indexOf(
      'rateLimitExceeded'
        .toLowerCase()
    ) !== -1 ||

    text.indexOf(
      'quotaExceeded'
        .toLowerCase()
    ) !== -1
  );
}


function formatHttpError(
  code,
  body
) {

  let message =
    body || '';


  try {

    const json =
      JSON.parse(
        body
      );


    if (
      json.error &&
      json.error.message
    ) {

      message =
        json.error.message;
    }

  } catch (ignore) {
    // Keep raw body.
  }


  return (
    'HTTP ' +
    code +
    ': ' +
    message
  );
}


/* ============================================================
   LOGGING
   ============================================================ */

let LOG_BUFFER = [];


function queueLog(
  row
) {

  LOG_BUFFER.push(
    row
  );


  if (
    LOG_BUFFER.length >=
    CONFIG.LOG_BATCH_SIZE
  ) {

    flushLog();
  }
}


function flushLog() {

  if (
    LOG_BUFFER.length === 0
  ) {

    return;
  }


  try {

    const sheet =
      getLogSheet();


    const rows =
      LOG_BUFFER;


    LOG_BUFFER =
      [];


    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rows.length,
        rows[0].length
      )
      .setValues(
        rows
      );


  } catch (error) {

    /*
     * Put rows back into memory so that a temporary logging
     * failure doesn't silently lose them.
     */

    LOG_BUFFER =
      LOG_BUFFER.concat(
        rows
      );


    Logger.log(
      'LOGGING ERROR: %s',
      errorMessage(error)
    );
  }
}


function logSystem(
  status,
  message
) {

  queueLog(
    [
      new Date(),
      'SYSTEM',
      '',
      '',
      status,
      message,
      '',
      '',
      ''
    ]
  );


  flushLog();
}


/* ============================================================
   GOOGLE SHEET LOG
   ============================================================ */

function ensureLogSpreadsheet() {

  const props =
    PropertiesService
      .getScriptProperties();


  const existingId =
    props.getProperty(
      CONFIG.PROPERTY_LOG_ID
    );


  if (existingId) {

    return SpreadsheetApp
      .openById(
        existingId
      );
  }


  const spreadsheet =
    SpreadsheetApp.create(
      'Google Drive Migration Log - Fast'
    );


  const sheet =
    spreadsheet
      .getSheets()[0];


  sheet.setName(
    'Migration Log'
  );


  sheet.appendRow(
    [

      'Timestamp',

      'Type',

      'Source ID',

      'Path',

      'Status',

      'Message',

      'Destination ID',

      'Destination Parent ID',

      'Source Modified Time'

    ]
  );


  sheet.setFrozenRows(
    1
  );


  props.setProperty(
    CONFIG.PROPERTY_LOG_ID,
    spreadsheet.getId()
  );


  Logger.log(
    'Migration log: %s',
    spreadsheet.getUrl()
  );


  return spreadsheet;
}


function getLogSpreadsheet() {

  return SpreadsheetApp
    .openById(

      PropertiesService
        .getScriptProperties()
        .getProperty(
          CONFIG.PROPERTY_LOG_ID
        )

    );
}


function getLogSheet() {

  return getLogSpreadsheet()
    .getSheetByName(
      'Migration Log'
    );
}


function getLogSpreadsheetUrl() {

  try {

    return getLogSpreadsheet()
      .getUrl();

  } catch (error) {

    return '(not created)';
  }
}


/* ============================================================
   INITIALIZATION
   ============================================================ */

function initializeMigration() {

  const props =
    PropertiesService
      .getScriptProperties();


  if (
    !props.getProperty(
      CONFIG.PROPERTY_STATS
    )
  ) {

    props.setProperty(

      CONFIG.PROPERTY_STATS,

      JSON.stringify({

        processed:
          0,

        copied:
          0,

        skipped:
          0,

        failed:
          0,

        folders:
          0,

        startedAt:
          new Date().toISOString()

      })

    );
  }


  ensureLogSpreadsheet();

  setStatus(
    'RUNNING'
  );
}


function setStatus(
  status
) {

  PropertiesService
    .getScriptProperties()
    .setProperty(
      CONFIG.PROPERTY_STATUS,
      status
    );
}


/* ============================================================
   STATS
   ============================================================ */

function getStats() {

  const value =
    PropertiesService
      .getScriptProperties()
      .getProperty(
        CONFIG.PROPERTY_STATS
      );


  return value

    ? JSON.parse(
        value
      )

    : {

        processed:
          0,

        copied:
          0,

        skipped:
          0,

        failed:
          0,

        folders:
          0
      };
}


function saveStats(
  stats
) {

  PropertiesService
    .getScriptProperties()
    .setProperty(
      CONFIG.PROPERTY_STATS,
      JSON.stringify(
        stats
      )
    );
}


function incrementStat(
  property
) {

  const stats =
    getStats();


  stats[property] =
    (stats[property] || 0) +
    1;


  saveStats(
    stats
  );
}


function getStatsSummary() {

  const stats =
    getStats();


  return (
    'Processed: ' +
    stats.processed +

    ' | Copied: ' +
    stats.copied +

    ' | Skipped: ' +
    stats.skipped +

    ' | Failed: ' +
    stats.failed +

    ' | Folders: ' +
    stats.folders
  );
}


/* ============================================================
   CONTINUATION
   ============================================================ */

function scheduleContinuation() {

  removeContinuationTriggers();


  ScriptApp
    .newTrigger(
      'runMigration'
    )
    .timeBased()
    .after(
      CONFIG.CONTINUE_AFTER_MS
    )
    .create();


  Logger.log(
    'Continuation scheduled.'
  );
}


function removeContinuationTriggers() {

  ScriptApp
    .getProjectTriggers()
    .forEach(
      trigger => {

        if (
          trigger.getHandlerFunction() ===
          'runMigration'
        ) {

          ScriptApp.deleteTrigger(
            trigger
          );
        }
      }
    );
}


/* ============================================================
   HELPERS
   ============================================================ */

function makeMigrationKey(
  sourceId,
  destinationParentId
) {

  return (
    sourceId +
    '|' +
    destinationParentId
  );
}


function validateConfiguration() {

  if (
    !CONFIG.SOURCE_FOLDER_ID ||
    CONFIG.SOURCE_FOLDER_ID.indexOf(
      'PASTE_'
    ) === 0
  ) {

    throw new Error(
      'SOURCE_FOLDER_ID is not configured.'
    );
  }


  if (
    !CONFIG.DESTINATION_SHARED_DRIVE_ID ||
    CONFIG
      .DESTINATION_SHARED_DRIVE_ID
      .indexOf(
        'PASTE_'
      ) === 0
  ) {

    throw new Error(
      'DESTINATION_SHARED_DRIVE_ID is not configured.'
    );
  }
}


function timeLimitReached(
  startTime
) {

  return (
    Date.now() -
    startTime >=
    CONFIG.MAX_RUNTIME_MS
  );
}


function errorMessage(
  error
) {

  if (!error) {
    return 'Unknown error';
  }


  if (error.message) {
    return error.message;
  }


  return String(
    error
  );
}