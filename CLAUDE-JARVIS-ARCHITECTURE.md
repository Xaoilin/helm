# CLAUDE: Jarvis Architecture — LLM Function Calling for Lina

## The Problem

Lina currently uses a **hardcoded keyword system** to understand commands:

```
User: "Add a task to buy milk"
→ Keyword matcher sees "task" → navigates to Tasks page
→ LLM never sees the command
→ User frustrated — they wanted to CREATE a task, not navigate
```

We patched this with `ACTION_VERBS` and `NAV_VERBS` lists, but it's fundamentally fragile. Every new phrase requires updating hardcoded arrays. This is the opposite of intelligent.

## The Solution: Ollama Function Calling (Tool Use)

**Kill the keyword system entirely. Let the LLM be the brain.**

Modern LLMs — including qwen3 running on Ollama — support **function calling** (also called "tool use"). You define a catalog of typed functions, and the LLM decides which function to call with what parameters based on natural language understanding. Not keyword matching. Not regex. The model *understands* what you want.

### How It Works

**You say:** *"Add a task to do the mirror in the small office"*

**The LLM receives your tools catalog and returns:**
```json
{
  "content": "Done! I've added that to your tasks.",
  "tool_calls": [{
    "function": {
      "name": "add_task",
      "arguments": {
        "title": "Do the mirror in the small office",
        "priority": "medium",
        "category": "task"
      }
    }
  }]
}
```

**You say:** *"What's my next meeting?"*
```json
{
  "tool_calls": [{
    "function": { "name": "get_next_meeting", "arguments": {} }
  }]
}
```
→ We execute `get_next_meeting()` locally (instant), feed the result back to the LLM, and it responds naturally: *"Your next meeting is ESOL at 18:30."*

**You say:** *"Schedule a dentist appointment for tomorrow at 2pm"*
```json
{
  "tool_calls": [{
    "function": {
      "name": "add_event",
      "arguments": {
        "title": "Dentist appointment",
        "start": "2026-04-07T14:00:00",
        "location": ""
      }
    }
  }]
}
```

## Why This Is The Best Solution

| Aspect | Current (Keywords) | Jarvis (Function Calling) |
|--------|-------------------|--------------------------|
| **Understanding** | Substring match (`includes()`) | Semantic understanding |
| **New capability** | Edit hardcoded arrays | Add one tool definition |
| **Parameter extraction** | Regex parsing of `[ADD_TASK:title\|priority\|category]` | Typed JSON schema |
| **Multilingual** | Separate keyword arrays per language | Works in any language the model speaks |
| **Ambiguity** | First keyword match wins (often wrong) | LLM reasons about context |
| **Clarification** | Can't ask follow-up questions | "What priority should the task be?" |
| **Complex commands** | One action at a time | Can chain multiple tool calls |
| **Date understanding** | None — "tomorrow" means nothing | LLM parses "tomorrow at 2pm" into ISO datetime |

## The Tools Catalog

These are the functions Lina can call:

### Navigation
| Tool | Description | Parameters |
|------|-------------|------------|
| `navigate` | Go to a page in the app | `surface` (enum: dashboard, calendar, tasks, finance, knowledge, profile, settings, chat, debug) |

### Task Management
| Tool | Description | Parameters |
|------|-------------|------------|
| `add_task` | Create a new task | `title` (required), `priority?` (low/medium/high), `category?` (daily/task/goal), `dueDate?` |
| `complete_task` | Mark a task as done | `title` (fuzzy match against existing tasks) |
| `complete_habit` | Complete a daily habit | `title` (fuzzy match against daily habits) |

### Calendar
| Tool | Description | Parameters |
|------|-------------|------------|
| `add_event` | Create a calendar event | `title`, `start` (ISO datetime), `end?`, `location?` |
| `get_next_meeting` | Get the next upcoming event | — |

### Data Queries
| Tool | Description | Parameters |
|------|-------------|------------|
| `get_tasks` | List pending tasks | `filter?` (today/all/goals) |
| `get_prayer_times` | Get today's prayer schedule | — |
| `get_streak` | Get current streak, XP, level | — |
| `get_task_count` | Count pending tasks | — |

### Finance
| Tool | Description | Parameters |
|------|-------------|------------|
| `add_transaction` | Log a financial transaction | `description`, `amount` (pence), `type` (income/expense), `category` |

### Knowledge
| Tool | Description | Parameters |
|------|-------------|------------|
| `search_knowledge` | Search the knowledge base | `query` |

### Settings
| Tool | Description | Parameters |
|------|-------------|------------|
| `set_setting` | Change an app setting | `key`, `value` |

## Architecture

```
User speaks/types
        ↓
  ┌─────────────┐
  │ Ollama API   │  ← tools catalog + system prompt + user context
  │ (qwen3)      │
  └──────┬───────┘
         ↓
   Response contains:
   ├── tool_calls? ──→ Execute function(s) ──→ Feed result back to LLM ──→ Natural response
   └── text only ──→ Speak/display directly (general conversation)
```

### Two-Pass for Data Queries

When the LLM calls a "read" tool (get_next_meeting, get_tasks, get_prayer_times):

1. **Pass 1:** LLM decides to call `get_next_meeting()`
2. **We execute** the function locally (instant, no API call)
3. **Pass 2:** We send the result back to the LLM as a tool response
4. **LLM responds** naturally: "Your next meeting is ESOL at 18:30 in Room 3."

This gives the LLM access to live app data while keeping data queries instant.

### One-Pass for Actions

When the LLM calls a "write" tool (add_task, complete_habit, navigate):

1. **Pass 1:** LLM decides to call `add_task({ title: "Buy milk", priority: "medium" })`
2. **We execute** the function immediately (creates the task)
3. **We use the LLM's text response** directly: "Done! I've added 'Buy milk' to your tasks."

No second pass needed — the LLM already knows what it asked to do.

## Implementation Plan

### Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/services/linaTools.ts` | **NEW** — Tool definitions (JSON schema) + executor functions |
| `src/services/ollamaApi.ts` | Add `tools` parameter to `chatWithOllama()` |
| `src/services/voiceAssistant.ts` | Replace `parseIntent()` + `processWithLLM()` with single `processCommand()` using tools |
| `src/components/VoiceAssistant.tsx` | Simplify `processTranscript()` — just call the LLM with tools |
| `src/store/contexts/ChatContext.tsx` | Update `sendMessage()` to use tools |

### What Gets Deleted

- `NAV_KEYWORDS` array
- `ACTION_VERBS` array
- `NAV_VERBS` array
- `SURFACE_LABELS` map
- `parseIntent()` function (replaced by LLM tool calling)
- `RESPONSES` bilingual templates (LLM generates natural responses)
- `parseLocalQueries()` function (becomes tool executor functions)
- All `[ADD_TASK:...]`, `[COMPLETE_TASK:...]`, `[NAV:...]` action tag parsing

### What Stays

- `speakWithElevenLabs()` / `speakWithBrowserTTS()` — voice output unchanged
- `buildSystemPrompt()` — still provides user context, but simplified (no ACTION TAGS section)
- Circuit breakers, retry logic, error handling — all resilience patterns stay
- Wake word detection — unchanged

## Ollama API Format

```typescript
const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    model: 'qwen3',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Add a task to buy milk' }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'add_task',
          description: 'Create a new task or todo item for the user',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The task title' },
              priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority' },
              category: { type: 'string', enum: ['daily', 'task', 'goal'], description: 'Task type' },
              dueDate: { type: 'string', description: 'Due date in ISO format (optional)' }
            },
            required: ['title']
          }
        }
      },
      // ... more tools
    ],
    stream: false,
    think: false,
  })
});
```

## Latency Analysis

| Command Type | Current Latency | Jarvis Latency | Acceptable? |
|-------------|----------------|----------------|-------------|
| "open calendar" | Instant (keyword) | 1-2s (LLM) | Yes — Siri/Alexa are similar |
| "add a task" | ❌ Broken (navigates) | 1-2s (LLM) | Yes — and it actually works |
| "what's my streak" | Instant (local) | 2-3s (LLM + tool + LLM) | Marginal — could optimize |
| "what should I focus on" | 2-3s (LLM) | 2-3s (LLM) | Same |
| General chat | 2-3s (LLM) | 2-3s (LLM) | Same |

**Optimization:** For simple data queries, we can keep a fast-path that checks if the LLM returned a tool call for a read-only function, executes it, and responds without a second LLM pass.

## Future Extensibility

Adding a new capability to Lina:

1. Define the tool in `linaTools.ts`:
```typescript
{
  name: 'set_alarm',
  description: 'Set an alarm or reminder',
  parameters: {
    type: 'object',
    properties: {
      time: { type: 'string', description: 'When to trigger (ISO datetime)' },
      message: { type: 'string', description: 'What to remind about' }
    },
    required: ['time', 'message']
  }
}
```

2. Add the executor function:
```typescript
function executeSetAlarm(args: { time: string; message: string }): string {
  // Create the alarm
  return `Alarm set for ${args.time}: ${args.message}`;
}
```

That's it. No keyword lists to update. No regex patterns. No bilingual translations. The LLM handles understanding in any language automatically.
