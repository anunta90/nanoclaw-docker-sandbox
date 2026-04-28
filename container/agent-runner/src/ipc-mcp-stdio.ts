/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = '/workspace/ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times.",
  {
    text: z.string().describe('The message text to send'),
    sender: z
      .string()
      .optional()
      .describe(
        'Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.',
      ),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools. Returns the task ID for future reference. To modify an existing task, use update_task instead.

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  {
    prompt: z
      .string()
      .describe(
        'What the agent should do when the task runs. For isolated mode, include all necessary context here.',
      ),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .describe(
        'cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time',
      ),
    schedule_value: z
      .string()
      .describe(
        'cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)',
      ),
    context_mode: z
      .enum(['group', 'isolated'])
      .default('group')
      .describe(
        'group=runs with chat history and memory, isolated=fresh session (include context in prompt)',
      ),
    target_group_jid: z
      .string()
      .optional()
      .describe(
        '(Main group only) JID of the group to schedule the task for. Defaults to the current group.',
      ),
    script: z
      .string()
      .optional()
      .describe(
        'Optional bash script to run before waking the agent. Script must output JSON on the last line of stdout: { "wakeAgent": boolean, "data"?: any }. If wakeAgent is false, the agent is not called. Test your script with bash -c "..." before scheduling.',
      ),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      if (
        /[Zz]$/.test(args.schedule_value) ||
        /[+-]\d{2}:\d{2}$/.test(args.schedule_value)
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Timestamp must be local time without timezone suffix. Got "${args.schedule_value}" — use format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid timestamp: "${args.schedule_value}". Use local time format like "2026-02-01T15:30:00".`,
            },
          ],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid =
      isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const data = {
      type: 'schedule_task',
      taskId,
      prompt: args.prompt,
      script: args.script || undefined,
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'group',
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${taskId} scheduled: ${args.schedule_type} - ${args.schedule_value}`,
        },
      ],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter(
            (t: { groupFolder: string }) => t.groupFolder === groupFolder,
          );

      if (tasks.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No scheduled tasks found.' },
          ],
        };
      }

      const formatted = tasks
        .map(
          (t: {
            id: string;
            prompt: string;
            schedule_type: string;
            schedule_value: string;
            status: string;
            next_run: string;
          }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return {
        content: [
          { type: 'text' as const, text: `Scheduled tasks:\n${formatted}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} pause requested.`,
        },
      ],
    };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} resume requested.`,
        },
      ],
    };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} cancellation requested.`,
        },
      ],
    };
  },
);

server.tool(
  'update_task',
  'Update an existing scheduled task. Only provided fields are changed; omitted fields stay the same.',
  {
    task_id: z.string().describe('The task ID to update'),
    prompt: z.string().optional().describe('New prompt for the task'),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .optional()
      .describe('New schedule type'),
    schedule_value: z
      .string()
      .optional()
      .describe('New schedule value (see schedule_task for format)'),
    script: z
      .string()
      .optional()
      .describe(
        'New script for the task. Set to empty string to remove the script.',
      ),
  },
  async (args) => {
    // Validate schedule_value if provided
    if (
      args.schedule_type === 'cron' ||
      (!args.schedule_type && args.schedule_value)
    ) {
      if (args.schedule_value) {
        try {
          CronExpressionParser.parse(args.schedule_value);
        } catch {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Invalid cron: "${args.schedule_value}".`,
              },
            ],
            isError: true,
          };
        }
      }
    }
    if (args.schedule_type === 'interval' && args.schedule_value) {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Invalid interval: "${args.schedule_value}".`,
            },
          ],
          isError: true,
        };
      }
    }

    const data: Record<string, string | undefined> = {
      type: 'update_task',
      taskId: args.task_id,
      groupFolder,
      isMain: String(isMain),
      timestamp: new Date().toISOString(),
    };
    if (args.prompt !== undefined) data.prompt = args.prompt;
    if (args.script !== undefined) data.script = args.script;
    if (args.schedule_type !== undefined)
      data.schedule_type = args.schedule_type;
    if (args.schedule_value !== undefined)
      data.schedule_value = args.schedule_value;

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Task ${args.task_id} update requested.`,
        },
      ],
    };
  },
);

server.tool(
  'register_group',
  `Register a new chat/group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name must be channel-prefixed: "{channel}_{group-name}" (e.g., "whatsapp_family-chat", "telegram_dev-team", "discord_general"). Use lowercase with hyphens for the group name part.`,
  {
    jid: z
      .string()
      .describe(
        'The chat JID (e.g., "120363336345536173@g.us", "tg:-1001234567890", "dc:1234567890123456")',
      ),
    name: z.string().describe('Display name for the group'),
    folder: z
      .string()
      .describe(
        'Channel-prefixed folder name (e.g., "whatsapp_family-chat", "telegram_dev-team")',
      ),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Only the main group can register new groups.',
          },
        ],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Group "${args.name}" registered. It will start receiving messages immediately.`,
        },
      ],
    };
  },
);

// ─── Second Brain: Wallabag ───────────────────────────────────────────────────

interface WallabagToken {
  access_token: string;
  expires_at: number;
}

let _wallabagToken: WallabagToken | null = null;

function wallabagConfigured(): boolean {
  return !!(
    process.env.WALLABAG_URL &&
    process.env.WALLABAG_CLIENT_ID &&
    process.env.WALLABAG_CLIENT_SECRET &&
    process.env.WALLABAG_USERNAME &&
    process.env.WALLABAG_PASSWORD
  );
}

function wallabagNotConfigured() {
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Wallabag is not configured. Add WALLABAG_URL, WALLABAG_CLIENT_ID, WALLABAG_CLIENT_SECRET, WALLABAG_USERNAME, and WALLABAG_PASSWORD to .env.',
      },
    ],
    isError: true,
  };
}

async function wallabagAuth(): Promise<string> {
  if (_wallabagToken && Date.now() < _wallabagToken.expires_at - 60_000) {
    return _wallabagToken.access_token;
  }
  const base = process.env.WALLABAG_URL!.replace(/\/$/, '');
  const resp = await fetch(`${base}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: process.env.WALLABAG_CLIENT_ID!,
      client_secret: process.env.WALLABAG_CLIENT_SECRET!,
      username: process.env.WALLABAG_USERNAME!,
      password: process.env.WALLABAG_PASSWORD!,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Wallabag auth failed (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  _wallabagToken = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return _wallabagToken.access_token;
}

async function wallabagFetch(method: string, endpoint: string, body?: object): Promise<unknown> {
  const base = process.env.WALLABAG_URL!.replace(/\/$/, '');
  const token = await wallabagAuth();
  const resp = await fetch(`${base}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`Wallabag API error (${resp.status}): ${await resp.text()}`);
  }
  return resp.json();
}

server.tool(
  'wallabag_get_entries',
  'List articles from your Wallabag read-later library. Returns ID, title, URL, tags, and reading time per entry. Use the ID with wallabag_get_entry to fetch full content.',
  {
    status: z
      .enum(['unread', 'archived', 'starred', 'all'])
      .default('unread')
      .describe('Filter by status: unread (default), archived, starred, or all'),
    page: z.number().int().min(1).default(1).describe('Page number (default: 1)'),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Results per page, max 100 (default: 20)'),
  },
  async (args) => {
    if (!wallabagConfigured()) return wallabagNotConfigured();
    try {
      const params = new URLSearchParams({
        sort: 'created',
        order: 'desc',
        page: String(args.page),
        perPage: String(args.per_page),
        detail: 'metadata',
      });
      if (args.status === 'unread') params.set('archive', '0');
      else if (args.status === 'archived') params.set('archive', '1');
      else if (args.status === 'starred') params.set('starred', '1');

      const data = (await wallabagFetch('GET', `/api/entries?${params}`)) as {
        _embedded: {
          items: Array<{
            id: number;
            title: string;
            url: string;
            reading_time: number;
            is_archived: number;
            is_starred: number;
            created_at: string;
            tags: Array<{ label: string }>;
          }>;
        };
        total: number;
        page: number;
        pages: number;
      };

      const items = data._embedded?.items ?? [];
      if (items.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No articles found.' }] };
      }

      const lines = items.map(
        (e) =>
          `[${e.id}] ${e.title || '(no title)'}\n  URL: ${e.url}\n  Tags: ${e.tags.map((t) => t.label).join(', ') || 'none'} | ${e.reading_time} min read | Added: ${e.created_at.slice(0, 10)}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `${data.total} total (page ${data.page}/${data.pages}):\n\n${lines.join('\n\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'wallabag_get_entry',
  'Fetch the full text content of a Wallabag article by its ID. Use wallabag_get_entries to find IDs.',
  {
    id: z.number().int().describe('The Wallabag entry ID'),
  },
  async (args) => {
    if (!wallabagConfigured()) return wallabagNotConfigured();
    try {
      const entry = (await wallabagFetch('GET', `/api/entries/${args.id}`)) as {
        id: number;
        title: string;
        url: string;
        content: string;
        reading_time: number;
        created_at: string;
        tags: Array<{ label: string }>;
      };

      const plainContent = entry.content
        ? entry.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : '(no content extracted)';

      const text = [
        `# ${entry.title || '(no title)'}`,
        `URL: ${entry.url}`,
        `Tags: ${entry.tags.map((t) => t.label).join(', ') || 'none'} | ${entry.reading_time} min read | Added: ${entry.created_at.slice(0, 10)}`,
        '',
        plainContent,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'wallabag_add_entry',
  'Save a URL to your Wallabag read-later library. Wallabag fetches the article content automatically.',
  {
    url: z.string().url().describe('The URL to save'),
    title: z.string().optional().describe('Custom title (optional — auto-fetched if omitted)'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Tags to apply, e.g. ["ai", "research"]'),
    starred: z.boolean().optional().describe('Star the entry immediately (default: false)'),
  },
  async (args) => {
    if (!wallabagConfigured()) return wallabagNotConfigured();
    try {
      const body: Record<string, unknown> = { url: args.url };
      if (args.title) body.title = args.title;
      if (args.tags?.length) body.tags = args.tags.join(',');
      if (args.starred) body.starred = 1;

      const entry = (await wallabagFetch('POST', '/api/entries', body)) as {
        id: number;
        title: string;
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved to Wallabag: "${entry.title || args.url}" (ID: ${entry.id})`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'wallabag_update_entry',
  'Archive, star, or retag a Wallabag entry. Only provided fields are changed.',
  {
    id: z.number().int().describe('The Wallabag entry ID'),
    archive: z.boolean().optional().describe('true = mark as read/archived, false = mark unread'),
    starred: z.boolean().optional().describe('true = star, false = unstar'),
    tags: z
      .array(z.string())
      .optional()
      .describe('Replace all tags with this list (empty array removes all tags)'),
  },
  async (args) => {
    if (!wallabagConfigured()) return wallabagNotConfigured();
    try {
      const body: Record<string, unknown> = {};
      if (args.archive !== undefined) body.archive = args.archive ? 1 : 0;
      if (args.starred !== undefined) body.starred = args.starred ? 1 : 0;
      if (args.tags !== undefined) body.tags = args.tags.join(',');

      await wallabagFetch('PATCH', `/api/entries/${args.id}`, body);

      const actions: string[] = [];
      if (args.archive !== undefined) actions.push(args.archive ? 'archived' : 'marked unread');
      if (args.starred !== undefined) actions.push(args.starred ? 'starred' : 'unstarred');
      if (args.tags !== undefined) actions.push(`tags → [${args.tags.join(', ') || 'none'}]`);

      return {
        content: [
          { type: 'text' as const, text: `Entry ${args.id}: ${actions.join(', ')}.` },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'wallabag_search',
  'Search your Wallabag library by keyword. Searches titles, content, and URLs.',
  {
    term: z.string().describe('Search keyword or phrase'),
    status: z
      .enum(['unread', 'archived', 'starred', 'all'])
      .default('all')
      .describe('Filter by status (default: all)'),
  },
  async (args) => {
    if (!wallabagConfigured()) return wallabagNotConfigured();
    try {
      const params = new URLSearchParams({
        term: args.term,
        sort: 'created',
        order: 'desc',
        perPage: '20',
      });
      if (args.status === 'unread') params.set('archive', '0');
      else if (args.status === 'archived') params.set('archive', '1');
      else if (args.status === 'starred') params.set('starred', '1');

      const data = (await wallabagFetch('GET', `/api/entries?${params}`)) as {
        _embedded: {
          items: Array<{
            id: number;
            title: string;
            url: string;
            reading_time: number;
            is_archived: number;
            tags: Array<{ label: string }>;
          }>;
        };
        total: number;
      };

      const items = data._embedded?.items ?? [];
      if (items.length === 0) {
        return { content: [{ type: 'text' as const, text: `No results for "${args.term}".` }] };
      }

      const lines = items.map(
        (e) =>
          `[${e.id}] ${e.title || '(no title)'} — ${e.reading_time} min | tags: ${e.tags.map((t) => t.label).join(', ') || 'none'}\n  ${e.url}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `${data.total} result(s) for "${args.term}":\n\n${lines.join('\n\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
