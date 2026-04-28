# Logseq — Knowledge Graph

Your Logseq vault is mounted read-write at `/workspace/extra/logseq`. Use the built-in `Read`, `Write`, and `Edit` tools to interact with it.

## Vault Structure

```
/workspace/extra/logseq/
├── pages/          ← Named pages (one file per concept/topic)
│   └── page-name.md
├── journals/       ← Daily journal entries
│   └── 2025_04_28.md   ← Format: YYYY_MM_DD.md
├── assets/         ← Images and attachments
└── logseq/         ← Logseq config (do not edit)
```

## File Format

Logseq uses Markdown with block-level indentation. Each bullet is a block.

```markdown
- Top-level block
  - Child block
    - Nested child
- Another block with **bold** or *italic*
- A TODO item
  - DONE Completed task
- A block with a tag #ai #research
- Property on a page:
  date:: 2025-04-28
  tags:: ai, research
```

## Daily Journal

Today's journal file: `journals/YYYY_MM_DD.md` (e.g., `journals/2025_04_28.md`).

To add to today's journal:
```
Read /workspace/extra/logseq/journals/2025_04_28.md  ← check if exists
Edit or Write the file, appending new blocks at the end
```

Standard journal entry structure:
```markdown
- [[2025-04-28]]
  - ## Inbox processed
    - Summarized 5 Wallabag articles
      - [[Article Title]] — key insight here #ai
        - Action: follow up on X
  - ## Actions
    - TODO Research X
    - TODO Read [[Page Name]]
```

## Common Workflows

### Write today's reading summary
```
1. Get today's date → determine journal filename
2. Read the journal file (create if missing)
3. Append a new section with summaries and extracted actions
```

### Create or update a named page
```
Write /workspace/extra/logseq/pages/topic-name.md
```

Use `[[Page Name]]` syntax to link between pages — Logseq auto-creates bidirectional links.

### Capture a quick note
```
Edit /workspace/extra/logseq/journals/YYYY_MM_DD.md
→ Append a new bullet at the bottom
```

### Process Wallabag + write to Logseq
```
1. /wallabag → wallabag_get_entries(status="unread")
2. wallabag_get_entry(id=...) for each interesting article
3. For each: extract title, key ideas, action items
4. Append to today's journal under ## Reading Inbox
5. wallabag_update_entry(id=..., archive=true)
```

## Setup Note

The vault mount requires a valid Linux filesystem path. Your current vault is on Google Drive (G:\), which is not directly accessible from WSL/Docker. To connect it, run:

```bash
npx tsx scripts/setup-logseq-mount.ts /your/linux/logseq/path
```

Options to get a Linux path:
- Clone the vault to `~/logseq` and sync with rclone
- Use Logseq's built-in sync + export to a Linux folder
- In WSL: mount the G: drive with `sudo mount -t drvfs G: /mnt/g` (if available)
