# Wallabag — Read-Later Library

Your Wallabag library is available via MCP tools. Use it to save, retrieve, and process articles as part of your second brain workflow.

## Available Tools

| Tool | What it does |
|------|-------------|
| `mcp__nanoclaw__wallabag_get_entries` | List articles (filter by unread/archived/starred/all) |
| `mcp__nanoclaw__wallabag_get_entry` | Fetch full text of an article by ID |
| `mcp__nanoclaw__wallabag_add_entry` | Save a URL to Wallabag |
| `mcp__nanoclaw__wallabag_update_entry` | Archive, star, or retag an article |
| `mcp__nanoclaw__wallabag_search` | Search by keyword across titles and content |

## Common Workflows

### Summarize unread articles
```
1. wallabag_get_entries(status="unread", per_page=10)
2. For each article: wallabag_get_entry(id=...) → summarize
3. wallabag_update_entry(id=..., archive=true) to mark as done
```

### Save a URL the user shares
```
wallabag_add_entry(url="...", tags=["topic"])
```

### Process inbox into Logseq
```
1. wallabag_get_entries(status="unread")
2. wallabag_get_entry(id=...) for each
3. Extract key ideas + actions
4. Write to Logseq daily journal (see /logseq skill)
5. wallabag_update_entry(id=..., archive=true)
```

### Find articles on a topic
```
wallabag_search(term="machine learning", status="all")
```

## Tips
- IDs are stable — use them to reference specific articles
- `per_page` up to 100 for bulk processing
- Tags are free-form strings; use consistent naming (e.g., "ai", "to-read", "action")
- Archived = read; starred = important/reference
