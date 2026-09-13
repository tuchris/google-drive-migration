# Google Drive Migration

Fast, restart-safe migration of files from a personal Google Drive to a Google Workspace Shared Drive.

The migration runs as a Google Apps Script using the Google Drive API. Files are copied directly within Google's infrastructure, without downloading them to the local computer or sending them through a third-party migration service.

## Features

* Recursive folder migration with folder structure preserved
* Google Docs, Sheets and Slides remain native Google Workspace files
* Copies files directly into a Workspace Shared Drive
* Destination files are owned by the organization
* Preserves the source file's `modifiedTime`
* Parallel file copying for improved performance
* Automatic retries for transient Drive API errors
* Automatic continuation across Apps Script execution limits
* Restart-safe: already migrated files are skipped
* Retry only currently failed files
* Persistent migration log in Google Sheets
* Original source files are never modified or deleted

## Intended use

This project is primarily intended for migrations such as:

```text
Personal Google Account
        │
        │ copy
        ▼
Google Workspace Shared Drive
```

The destination is a Shared Drive rather than the Workspace user's `My Drive`, so migrated files belong to the organization rather than the individual user.

## Requirements

* A Google Workspace account with access to the destination Shared Drive
* A personal Google account containing the source data
* A Shared Drive in the Workspace organization
* Google Apps Script
* Drive API v3 enabled as an Advanced Google Service
* Permission for the Workspace account to access the source files
* External sharing between the personal account and Workspace organization, where required by the Workspace configuration

## Setup

Create a new Google Apps Script project and add the **Drive API** under:

**Services → + → Drive API**

Use Drive API **v3**.

Paste the migration script into the project.

Configure only these two values:

```javascript
const CONFIG = {
  SOURCE_FOLDER_ID:
    'YOUR_PERSONAL_SOURCE_FOLDER_ID',

  DESTINATION_SHARED_DRIVE_ID:
    'YOUR_WORKSPACE_SHARED_DRIVE_ID',
};
```

### Source folder ID

Open the source folder in the personal Google Drive.

For a URL such as:

```text
https://drive.google.com/drive/folders/1AbCdEf...
```

the folder ID is:

```text
1AbCdEf...
```

### Shared Drive ID

The destination value must be the **Shared Drive ID itself**, not the ID of a folder inside the Shared Drive.

You can use the script function:

```text
listSharedDrives()
```

to list the Shared Drives available to the Workspace account.

## Test before migrating

Before starting a large migration, run:

```text
testConfiguration()
```

This verifies that:

* the source folder exists
* the source is a folder
* the destination Shared Drive exists
* the Workspace account can access the Shared Drive

No files are copied by this test.

## Start the migration

Run:

```text
runMigration()
```

The script recursively scans the source folder and copies its contents into the Shared Drive.

The resulting structure looks like:

```text
Personal Drive
└── My Data
    ├── Photos
    │   ├── 2024
    │   └── 2025
    ├── Documents
    │   └── Notes
    └── Projects
        └── Project A
```

becoming:

```text
Workspace Shared Drive
└── My Data
    ├── Photos
    │   ├── 2024
    │   └── 2025
    ├── Documents
    │   └── Notes
    └── Projects
        └── Project A
```

## Native Google files

The migration uses the Google Drive API's copy operation. It does not export and re-import Google Workspace files.

Therefore:

```text
Google Doc    → Google Doc
Google Sheet  → Google Sheet
Google Slides → Google Slides
PDF           → PDF
JPG           → JPG
DOCX          → DOCX
XLSX          → XLSX
```

No Office conversion is performed.

## Restart and resume

The migration is designed to be safe to interrupt and restart.

Each destination item receives an internal migration marker based on its source ID and destination parent.

When the script runs again, already-copied items are detected and skipped rather than copied again.

This means the script can safely continue after:

* Apps Script execution limits
* temporary API errors
* network problems
* manual interruption
* quota/rate-limit errors

Use:

```text
showMigrationStatus()
```

to inspect the current migration state.

## Failed files

Files that cannot be copied are recorded in the migration log.

After the main migration has completed, run:

```text
retryFailedFiles()
```

This retries only items whose latest recorded status is `FAILED`.

Successfully migrated items are not copied again.

## Migration log

The script creates a Google Sheet named:

```text
Google Drive Migration Log - Fast
```

The log records information such as:

* timestamp
* source ID
* source path
* status
* error message
* destination ID
* destination parent
* source `modifiedTime`

This makes it possible to identify and retry individual failures.

## Performance

The migration uses parallel copy requests to reduce the latency caused by sequential Drive API calls.

The default setting is:

```javascript
CONCURRENT_COPIES: 8
```

If the migration runs reliably, this can potentially be increased. Higher concurrency can, however, cause Drive API rate limiting.

Google documents a per-user daily limit of 750 GB for uploads and copies, so very large migrations may also be constrained by Google's quotas.

The migration is therefore optimized for throughput without attempting to bypass Google's API limits.

## What is preserved

The migration preserves:

* folder structure
* file contents
* native Google Workspace file types
* source file `modifiedTime`

## What is not preserved

The migration intentionally does **not** attempt to preserve:

* file version history
* existing sharing permissions / ACLs
* comments and collaboration history
* ownership of individual files from the source account

The destination copies are created in the Workspace Shared Drive and are therefore organization-owned.

This behavior is intentional: the goal is to create a clean organization-owned copy of the source data.

## Source data safety

The migration is **copy-based**.

The original files in the personal Google account are not deleted or moved.

After the migration has been verified, the original data can be removed manually if desired.

## Resetting migration state

To reset the script's internal status and counters:

```text
resetMigrationState()
```

This does **not** delete destination files.

Previously migrated files remain detectable and will be skipped on the next migration run.

## Security and privacy

The migration does not use a third-party migration service.

The optimized copy operations call Google's Drive API directly using the OAuth credentials of the Workspace account running the script.

No file contents are intentionally sent to an external migration provider.

The script does request permission to use Apps Script's HTTP fetch service because the optimized version uses `UrlFetchApp` to issue parallel requests to:

```text
https://www.googleapis.com/drive/v3/
```

## Limitations

Google Drive and Workspace administrator policies can prevent individual files from being copied.

Examples include:

* insufficient permissions
* administrator sharing restrictions
* files with copy restrictions
* API quota/rate limiting
* unsupported or special Drive content

Such failures are recorded in the migration log and can be retried with:

```text
retryFailedFiles()
```

## Disclaimer

This project is provided as a migration utility and should be tested with a small folder before being used for a large or business-critical migration.

No guarantee is given that the code works as intended. It is the responsibility of every user of the tool to verify that all actions on google drive are as intended and that potential problems with the tool are fixed. 

Always verify the destination before deleting the original source data.
