# ProjectAnvil source control

ProjectAnvil already has a local Git repository on the `main` branch. Git keeps a history of the app's source code on this PC. The existing history is preserved. No GitHub repository or remote is connected yet.

## Open the project in VS Code

1. Choose **File → Open Folder** and open `D:\ProjectAnvil`.
2. Open **Source Control** in the left sidebar, or press **Ctrl+Shift+G**. VS Code should recognize the repository automatically; do not initialize it again.
3. Review the changes listed here before committing them. The current app source has a local checkpoint commit.

To run the app from VS Code, choose **Terminal → Run Task → Run ProjectAnvil**. Keep its terminal open and press **Ctrl+C** there to stop it. The other included tasks check types, test storage behavior, and build the app. Node.js must be installed and available in VS Code's terminal; restart VS Code after installing Node.

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

## Keep app data backed up separately

Git tracks the app code and setup files. These local files are excluded:

- `.wrangler/`: the active database and uploaded attachments.
- `backups/`: saved workspace copies and prior archives.
- `node_modules/`, `dist/`, `.next/`, and `.vinext/`: installed dependencies and generated output.
- `.env*` and `.dev.vars*`: private environment settings.
- `.sites-runtime/`, local tool folders, and TypeScript build caches.

Git commits and GitHub pushes do not back up your notes, tasks, or uploaded media. Stop ProjectAnvil and copy `.wrangler/state` separately when backing up your work. The README explains how to restore it.

Avoid **Discard Changes**, deleting `.wrangler`, or Git reset/clean commands as troubleshooting steps unless you intend to remove the affected work.
