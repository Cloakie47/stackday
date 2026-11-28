# Daily start routine (for growthmindsetgg's Claude)

Paste the prompt below into Claude Code at the start of every working day, from your local Stackday folder. It only reads: it does not change code, commit, push or comment.

---

Start-of-day check for Stackday. Read only: do not edit files, commit, push, merge, comment or close anything during this check.

1. Run `git fetch --all --prune`, then `git checkout main` and `git pull`. If I have uncommitted work, do not switch branches: tell me and stop.
2. Find what changed since my last working day. Use the date of my most recent commit on any branch (`git log --all --author=growthmindsetgg -1 --format=%cI`), or the last 24 hours if there is none. List:
   - commits on main since then (`git log --since=<date> --format="%h %an %ad %s" --date=short main`), grouped by author, with the files each touched (`git show --stat`)
   - pull requests merged, opened or updated since then (`gh pr list --state all --search "updated:>=<date>"`), with their state, CI result (`gh pr checks <n>`) and any review comments
   - issues opened, updated or assigned to me (`gh issue list --state all --search "updated:>=<date>"`), with any that mention @growthmindsetgg called out first
   - for each of my open pull requests: is it behind main, does it have merge conflicts (`gh pr view <n> --json mergeable,mergeStateStatus`), did CI pass, and is anyone waiting on me
3. Read the project rules again: CLAUDE.md, docs/ANCHOR.md (the status table) and docs/START-HERE.md. Note anything in them that changed since my last day.
4. Check for overlap: does anything merged or in progress touch the same files or features as my open work? Say exactly which files.
5. Write two reports in plain English, no em dashes:
   - **Short report**: one paragraph of at most 6 sentences: what changed, what needs my attention today, and the single most important next step.
   - **Long report**, with these headings: Commits on main (by author), Pull requests (merged, open, waiting on me), Issues and mentions, My open pull requests (behind main, conflicts, CI), Rule or anchor changes, Overlap and conflict risks, Suggested plan for today (ordered, each step linked to the anchor part it serves).
   Save both to `notes/daily/<today's date>.md` (the notes folder is not committed; add `notes/` to my local `.git/info/exclude` if it is not ignored yet), and show me the short report in chat.
6. Stop and wait for me to say what to work on. Remember the team rules: never commit or push to main, branch as `gg/<topic>`, contract changes need an agreed issue first, only the founder publishes the live site or touches the official testnet deployment and the live database.
