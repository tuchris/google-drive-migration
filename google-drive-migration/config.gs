/* ============================================================
   CONFIGURATION
   ============================================================ */

const CONFIG = {

  // ==========================================================
  // ONLY CHANGE THESE TWO VALUES
  // ==========================================================

  SOURCE_FOLDER_ID:
    '<your source folder ID>',

  DESTINATION_SHARED_DRIVE_ID:
    '<your shared drive ID>',


  // ==========================================================
  // PERFORMANCE
  // ==========================================================

  /*
   * Number of simultaneous copy requests.
   *
   * Start with 8.
   *
   * If the migration runs cleanly without 429 / rate-limit
   * errors, you can try 10 or 12.
   */
  CONCURRENT_COPIES:
    8,


  /*
   * Number of log rows written to Sheets in one operation.
   */
  LOG_BATCH_SIZE:
    100,


  /*
   * Keep execution safely below the Apps Script limit.
   */
  MAX_RUNTIME_MS:
    5 * 60 * 1000,


  /*
   * Retry attempts for transient errors.
   */
  MAX_RETRIES:
    5,


  /*
   * Initial exponential backoff.
   */
  RETRY_BASE_DELAY_MS:
    1000,


  /*
   * Delay before automatic continuation.
   */
  CONTINUE_AFTER_MS:
    30 * 1000,


  /*
   * Log progress every N copied/processed files.
   */
  PROGRESS_EVERY:
    100,


  // ==========================================================
  // INTERNAL PROPERTY NAMES
  // ==========================================================

  PROPERTY_STATUS:
    'MIGRATION_STATUS',

  PROPERTY_STATS:
    'MIGRATION_STATS',

  PROPERTY_LOG_ID:
    'MIGRATION_LOG_SPREADSHEET_ID'
};
