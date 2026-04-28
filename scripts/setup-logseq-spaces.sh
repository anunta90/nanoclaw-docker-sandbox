#!/usr/bin/env bash
# Rename Logseq spaces and create the Cortex second-brain space.
# Run from WSL: bash scripts/setup-logseq-spaces.sh /path/to/logseq/vault

set -e

VAULT="${1:-$HOME/logseq}"

if [ ! -d "$VAULT" ]; then
  echo "Vault not found at: $VAULT"
  echo "Usage: bash scripts/setup-logseq-spaces.sh /path/to/logseq"
  exit 1
fi

echo "Vault: $VAULT"
echo ""

# ─── Rename existing spaces ───────────────────────────────────────────────────

if [ -d "$VAULT/personal_restrella" ] && [ ! -d "$VAULT/life" ]; then
  mv "$VAULT/personal_restrella" "$VAULT/life"
  echo "✓ Renamed personal_restrella → life"
elif [ -d "$VAULT/life" ]; then
  echo "  life already exists, skipping rename"
else
  echo "  personal_restrella not found, skipping"
fi

if [ -d "$VAULT/restrella" ] && [ ! -d "$VAULT/lab" ]; then
  mv "$VAULT/restrella" "$VAULT/lab"
  echo "✓ Renamed restrella → lab"
elif [ -d "$VAULT/lab" ]; then
  echo "  lab already exists, skipping rename"
else
  echo "  restrella not found, skipping"
fi

# ─── Create Cortex space ──────────────────────────────────────────────────────

CORTEX="$VAULT/cortex"
mkdir -p "$CORTEX/pages" "$CORTEX/journals" "$CORTEX/assets" "$CORTEX/logseq"

echo ""
echo "Creating Cortex space..."

cat > "$CORTEX/logseq/config.edn" << 'EOF'
{:meta/version 1
 :preferred-format :markdown
 :pages-directory "pages"
 :journals-directory "journals"
 :journal/page-title-format "yyyy-MM-dd"
 :journal/file-name-format "yyyy_MM_dd"
 :ui/enable-tooltip? true
 :feature/enable-journals? true}
EOF

cat > "$CORTEX/pages/Inbox.md" << 'EOF'
---
title: Inbox
tags: system
---

- ## Unprocessed
  - Items captured here are waiting to be processed into Projects, Areas, or Resources.
  - Process weekly: move each item to the right place or discard.

- ## How to use
  - Quick capture → add a bullet here with #inbox tag
  - Wallabag summaries → land in daily journals, then move here if actionable
  - Weekly review → clear this page
EOF

cat > "$CORTEX/pages/MOC Index.md" << 'EOF'
---
title: MOC Index
tags: system, moc
---

- ## Maps of Content
  - A MOC is an index page that links to related notes on a topic.
  - Create one per major theme: [[AI]], [[Health]], [[Finance]], etc.

- ## Active MOCs
  - (Add links here as you create topic MOCs)

- ## How to create a MOC
  - Create a page named e.g. "AI MOC"
  - List all related notes as `[[Page Name]]` links
  - Tag it `#moc`
EOF

cat > "$CORTEX/pages/Projects.md" << 'EOF'
---
title: Projects (PARA)
tags: system, para
---

- ## Active Projects
  - A project has a clear outcome and deadline.
  - Move here from [[Inbox]] when you commit to it.

- ## Template for each project
  - **Goal:** what done looks like
  - **Next action:** the very next physical step
  - **Deadline:**
  - **Notes:**
EOF

cat > "$CORTEX/pages/Areas.md" << 'EOF'
---
title: Areas (PARA)
tags: system, para
---

- ## Ongoing Responsibilities
  - An area has no end date — it's maintained over time.
  - Examples: Health, Finances, Learning, Career, Relationships

- ## My Areas
  - (List your areas here)
EOF

cat > "$CORTEX/pages/Resources.md" << 'EOF'
---
title: Resources (PARA)
tags: system, para
---

- ## Reference Topics
  - Things you're interested in but not actively working on.
  - Connected to [[Lab]] for deep research notes.

- ## My Resources
  - (List topics you collect reference material on)
EOF

cat > "$CORTEX/pages/Archive.md" << 'EOF'
---
title: Archive (PARA)
tags: system, para
---

- ## Completed or Dormant
  - Move here from Projects or Areas when done or paused.
  - Keep for reference — don't delete.

- ## Archived Items
  - (Move items here with date completed)
EOF

cat > "$CORTEX/pages/Reading Pipeline.md" << 'EOF'
---
title: Reading Pipeline
tags: system, wallabag
---

- ## How reading flows into Cortex
  - 1. Save URL → Wallabag (via Hades or browser extension)
  - 2. Daily: Hades pulls unread articles, summarizes, writes to today's journal
  - 3. Key insights → extracted as bullets under ## Reading in the journal
  - 4. Actionable items → added to [[Inbox]] or a specific [[Projects]] entry
  - 5. Article archived in Wallabag

- ## Ask Hades
  - "Process my Wallabag inbox" → summarizes unread, writes to today's journal
  - "What did I read about X?" → searches Wallabag + Cortex journals
  - "Save this URL: ..." → saves to Wallabag with auto-tagging
  - "Star everything about AI from last week" → bulk Wallabag update
EOF

echo "✓ Cortex space created at $CORTEX"
echo ""
echo "Structure:"
find "$CORTEX" -type f | sort | sed "s|$VAULT/||"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next steps:"
echo ""
echo "1. In Logseq (Windows app):"
echo "   → Remove the old 'personal_restrella' and 'restrella' graphs"
echo "   → Add graphs: open each folder inside G:\\My Drive\\Applications\\Logseq\\"
echo "      life, lab, cortex"
echo ""
echo "2. Run rclone bisync to push changes to Google Drive:"
echo "   rclone bisync \"gdrive:Applications/Logseq\" $VAULT --create-empty-src-dirs"
echo ""
echo "3. Wire Cortex into NanoClaw (it reads the whole vault):"
echo "   npx tsx scripts/setup-logseq-mount.ts $VAULT"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
