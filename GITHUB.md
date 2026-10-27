# ProjectAnvil source control

Use Git to review and save the app's source, then publish or push it to your GitHub repository from VS Code. A cloned repository already includes its Git history.

## Open the project in VS Code

1. Choose **File → Open Folder** and open the ProjectAnvil repository folder.
2. Open **Source Control** in the left sidebar, or press **Ctrl+Shift+G**. VS Code should recognize the repository automatically; do not initialize it again.
3. Review the changes listed here before committing them. The current app source has a local checkpoint commit.

To run the app from VS Code, choose **Terminal → Run Task → Run ProjectAnvil**. It builds the production app when needed and opens the normal local address, including installation and offline startup support. Keep its terminal open for account access and synchronization; press **Ctrl+C** there to stop it. Use `npm run dev` in a terminal for live source editing; development mode does not update the installable app cache. The other included tasks check types, test storage behavior, and build the app. Node.js must be installed and available in VS Code's terminal; restart VS Code after installing Node.

## Publish the source to your GitHub account

1. In **Source Control**, choose **Publish Branch** or **Publish to GitHub**.
2. Sign in to the GitHub account you want to use when VS Code asks.
3. Enter a repository name, such as `projectanvil`.
4. Choose **Publish to GitHub private repository** unless you intend to share the source publicly.

If the button is not visible, press **Ctrl+Shift+P**, run **Publish to GitHub**, and follow the prompts. These steps use VS Code's [built-in repository publishing](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes).

VS Code creates the repository in your account and connects it as the Git remote. Publishing source code does not start a website or upload your active ProjectAnvil workspace. The app keeps running locally.

## Save later source changes

1. Review the changed files in **Source Control**.
2. Use **+** to stage the files you want in the next version.
3. Write a short commit message describing the change, then choose **Commit**.
4. Choose **Sync Changes** or **Push** when you want to send those commits to GitHub.

You can keep making local commits without publishing or connecting to GitHub. If Git asks for a name and email, supply the identity you want recorded on your commits. A GitHub private email address can be used if you prefer.

GitHub Actions validates source changes and runs a separate two-account Chromium browser suite against disposable local data. Failed browser runs retain diagnostic reports for seven days. These checks do not host the app. See [Testing](docs/TESTING.md) for the same commands locally and for optional performance measurements.

## Keep app data backed up separately

Git tracks the app code and setup files. These local files are excluded:

- `.wrangler/`: the active database and uploaded attachments.
- `backups/`: saved workspace copies and prior archives.
- `node_modules/`, `dist/`, `.next/`, and `.vinext/`: installed dependencies and generated output.
- `.env*` and `.dev.vars*`: private environment settings.
- `.sites-runtime/`, local tool folders, and TypeScript build caches.

Git commits and GitHub pushes do not back up your notes, tasks, uploaded media, personal work rooms, browser offline copies, or queued edits. Synchronize or download unfinished browser work before backing up. Stop ProjectAnvil and copy `.wrangler/state` together with the matching private `.dev.vars` file. The [local setup guide](docs/LOCAL_SETUP.md#data-and-backups) explains complete backup and restore steps.

Avoid **Discard Changes**, deleting `.wrangler`, or Git reset/clean commands as troubleshooting steps unless you intend to remove the affected work.
