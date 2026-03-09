# API Map - GUI Specification

> **Visual management for your LLM gateway.**

## Overview

The GUI provides a user-friendly web interface for configuring and monitoring the API Map server. It emphasizes:

- **Simplicity**: Common tasks take 1-2 clicks
- **Visibility**: See what's happening in real-time
- **Safety**: Auto-save with instant rollback
- **Testing**: Try models directly from the browser

## Design Principles

1. **Zero Config for Basics**: Add a provider → Paste API key → Done
2. **Discoverability**: Unrouted requests show up instantly with one-click fixes
3. **Confidence**: See the exact request/response flow for debugging
4. **Safety**: Every change auto-saves; rollback to any point in time

---

## Navigation Structure

```
┌─────────────────────────────────────────────────────────────┐
│  API Map                              [Status Indicator]    │
├──────────┬──────────────────────────────────────────────────┤
│          │                                                  │
│  🏠 Dashboard     │  [Main Content Area]                     │
│  🔌 Providers     │                                          │
│  🛣️ Routes        │                                          │
│  🧪 Test Models   │                                          │
│  📋 Logs          │                                          │
│  💾 Backups       │                                          │
│  ⚙️ Config        │                                          │
│          │                                                  │
│          │                                                  │
│  ────────┼──────────────────────────────────────────────────┤
│          │  Server: http://localhost:3000                   │
│  Version │  Uptime: 2h 34m                                  │
│  v2.0.0  │                                                  │
└──────────┴──────────────────────────────────────────────────┘
```

---

## Pages

### 1. Dashboard

**Purpose**: Overview of system health and alerts.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                  │
│  Overview of your model router                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Total    │ │ Routed   │ │ Unrouted │ │ Avg      │       │
│  │ 1,523    │ │ 1,500 ✓  │ │ 23 ⚠️    │ │ 450ms    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⚠️ Unrouted Requests (23)                           │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ unknown-model  /v1/chat/completions  10:30:15 AM   │   │
│  │      [Create Route] [View Details]                 │   │
│  │                                                      │   │
│  │ gpt-5-preview  /v1/chat/completions  10:28:42 AM   │   │
│  │      [Create Route] [View Details]                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Features

| Feature | Description |
|---------|-------------|
| Stats Cards | Total/Routed/Unrouted requests + average latency |
| Auto-refresh | Updates every 5 seconds |
| Unrouted List | Shows unmatched model requests with timestamps |
| Quick Actions | "Create Route" button for each unrouted request |

#### Unrouted Request Actions

Clicking **Create Route** opens a modal:

```
┌────────────────────────────────────────────┐
│  Create Route for "unknown-model"          │
├────────────────────────────────────────────┤
│                                            │
│  Pattern: [unknown-model    ]              │
│           Suggested: "unknown*" or exact   │
│                                            │
│  Provider: [▼ OpenAI                      ]│
│                                            │
│  [✓ Save and Route] [Cancel]               │
│                                            │
└────────────────────────────────────────────┘
```

---

### 2. Providers

**Purpose**: Configure upstream LLM providers and API keys.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Providers                                    [Save Changes]│
│  Configure upstream AI model providers                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ☁️ Cloud Providers                                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  🟢 OpenAI                              Configured │   │
│  │     Base URL: https://api.openai.com/v1           │   │
│  │     API Key:  [••••••••••••sk-abc] [👁️]           │   │
│  │     Env Var:  [OPENAI_API_KEY       ]             │   │
│  │     Timeout:  [180                        ] sec   │   │
│  │     [✓] Supports streaming                        │   │
│  │                                                    │   │
│  │  ⚪ Anthropic                          Not Config │   │
│  │     [Add API Key to Enable]                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏠 Local Providers                                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  🟢 Ollama                            Configured   │   │
│  │     Base URL: http://localhost:11434              │   │
│  │     (No API key required for local providers)     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add Custom Provider]                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Provider Card Structure

Each provider shows:

| Element | Description |
|---------|-------------|
| Status Indicator | 🟢 Configured / ⚪ Not Configured |
| Provider Icon | Cloud for remote, home for local |
| Base URL | Editable text field |
| API Key | Password field with show/hide toggle |
| Env Var | Alternative to direct API key |
| Timeout | Slider or number input (10-600s) |
| Streaming Toggle | Checkbox for streaming support |

#### Quick Setup Flow

For most users, enabling a provider takes 2 steps:

1. **Paste API Key** → Auto-detects format
2. **Click Save** → Done

The system automatically:
- Sets the correct base URL
- Configures auth header format
- Suggests appropriate timeout
- Validates the key on save

#### Custom Providers

```
┌────────────────────────────────────────────┐
│  ➕ Add Custom Provider                    │
├────────────────────────────────────────────┤
│                                            │
│  Name: [My Custom API            ]         │
│                                            │
│  Base URL: [https://api.example.com/v1]    │
│                                            │
│  API Key: [••••••••••••••          ]       │
│                                            │
│  Auth Header: [Authorization     ]         │
│  Auth Prefix: [Bearer            ]         │
│                                            │
│  Format: [▼ OpenAI-compatible    ]         │
│                                            │
│  [✓ Add Provider] [Cancel]                 │
│                                            │
└────────────────────────────────────────────┘
```

---

### 3. Routes

**Purpose**: Define how model names map to providers.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Routes                                       [Save Changes]│
│  Configure model routing patterns                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Default Provider: [▼ OpenAI                    ] [Update] │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Active Routes (12)                                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  Priority │ Pattern        │ Provider   │ Actions   │   │
│  │ ──────────┼────────────────┼────────────┼───────────│   │
│  │    100    │ gpt-4*         │ openai     │ ✏️ 🗑️    │   │
│  │    100    │ claude-3*      │ anthropic  │ ✏️ 🗑️    │   │
│  │     90    │ local/*        │ ollama     │ ✏️ 🗑️    │   │
│  │     50    │ *              │ openai     │ ✏️ 🗑️    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [+ Add Route]  [Test Pattern]                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Add/Edit Route Modal

```
┌────────────────────────────────────────────┐
│  🛣️ Add Route                              │
├────────────────────────────────────────────┤
│                                            │
│  Pattern: [gpt-4*                ]         │
│  ┌────────────────────────────────────┐    │
│  │ Pattern Help:                      │    │
│  │ • * matches any characters         │    │
│  │ • ? matches single character       │    │
│  │ • ${1}, ${2} for capture groups    │    │
│  └────────────────────────────────────┘    │
│                                            │
│  Provider: [▼ OpenAI               ]       │
│                                            │
│  Model (optional):                         │
│  [gpt-4o                         ]         │
│  Leave empty to use requested model name   │
│                                            │
│  Priority: [━━●━━━━━━] 75                  │
│  Higher = checked first                    │
│                                            │
│  [✓ Save Route] [Cancel]                   │
│                                            │
└────────────────────────────────────────────┘
```

#### Pattern Tester

```
┌────────────────────────────────────────────┐
│  🧪 Test Pattern                           │
├────────────────────────────────────────────┤
│                                            │
│  Pattern: [claude-3*               ]       │
│  Test Model: [claude-3-opus-20240229]      │
│                                            │
│  Result: ✅ MATCHES                       │
│  Would route to: anthropic                │
│  Using model: claude-3-opus-20240229      │
│                                            │
│  Test another:                             │
│  • claude-3-sonnet → ✅ MATCHES           │
│  • gpt-4o → ❌ NO MATCH                   │
│                                            │
└────────────────────────────────────────────┘
```

---

### 4. Test Models

**Purpose**: Directly test any configured model with full visibility.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  🧪 Test Models                                             │
│  Test your configured models directly                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────┐  ┌─────────────────────────────┐│
│  │ MODEL SELECTION       │  │ RESPONSE                    ││
│  │                       │  │                             ││
│  │ Model: [gpt-4o ▼]     │  │ ┌─────────────────────────┐ ││
│  │ or type: [________]   │  │ │ Hello! How can I help   │ ││
│  │                       │  │ │ you today?              │ ││
│  │ ┌─────────────────┐   │  │ │                         │ ││
│  │ │ gpt-4o          │   │  │ │ [▌] (streaming...)      │ ││
│  │ │ gpt-4o-mini     │   │  │ └─────────────────────────┘ ││
│  │ │ claude-3-opus   │   │  │                             ││
│  │ │ local/llama2    │   │  │ Provider: openai            ││
│  │ │ ...             │   │  │ Model: gpt-4o               ││
│  │ └─────────────────┘   │  │ Tokens: 150                 ││
│  │                       │  │ Duration: 1.2s              ││
│  ├───────────────────────┤  │                             ││
│  │ YOUR MESSAGE          │  │ [📋 Copy] [🔍 Debug]        ││
│  │                       │  └─────────────────────────────┘│
│  │ [                    │                                 │
│  │  Type your message   │                                 │
│  │  here...             │                                 │
│  │                      │                                 │
│  │              ][➤]    │                                 │
│  └───────────────────────┘                                 │
│                                                             │
│  [⚙️ Advanced Settings]                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Quick Prompts

When message box is empty, show quick prompts:

```
Quick prompts: [Say hello] [Explain yourself] [Write code] [Creative]
```

#### Advanced Settings (Collapsible)

```
┌────────────────────────────────────────────┐
│  ⚙️ Advanced Settings              [▲]     │
├────────────────────────────────────────────┤
│                                            │
│  System Message:                           │
│  [You are a helpful assistant...    ]      │
│                                            │
│  Temperature: [━━●━━━━] 0.7                │
│  Precise ◄────────────► Creative           │
│                                            │
│  Max Tokens: [━━●━━━━] 1024                │
│                                            │
│  API Format: [●] OpenAI  [ ] Anthropic     │
│                                            │
│  [✓] Enable streaming                      │
│                                            │
└────────────────────────────────────────────┘
```

#### Debug View

Clicking **Debug** expands to show raw request/response:

```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Debug View                                    [Close]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Request (POST /v1/chat/completions):                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ {                                                   │   │
│  │   "model": "gpt-4o",                               │   │
│  │   "messages": [{"role": "user", "content": "Hi"}]   │   │
│  │ }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Routing: gpt-4o → openai → gpt-4o                         │
│                                                             │
│  Response (200 OK, 450ms):                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ {                                                   │   │
│  │   "choices": [{"message": {"content": "Hello!"}}]    │   │
│  │ }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 5. Logs

**Purpose**: View detailed request/response history.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Logs                                                    │
│  Request history and debugging                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Filter: [All ▼]  Search: [__________]  [🔄 Refresh]        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⏰ 10:30:15  gpt-4o  →  openai           200  450ms│   │
│  │    "Hello, how are you?"                             │   │
│  │                              [Details] [Replay]     │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⏰ 10:29:42  claude-3  →  anthropic       200  890ms│   │
│  │    "Explain quantum computing"                       │   │
│  │                              [Details] [Replay]     │   │
│  │ ⏰ 10:28:15  unknown   →  ❌ 404         No route   │   │
│  │    "Generate an image"                               │   │
│  │                              [Details] [Create Route│   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Showing 50 most recent requests                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Log Entry Details

```
┌─────────────────────────────────────────────────────────────┐
│  Request Details                                [✕ Close]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Request ID: req_abc123                                     │
│  Timestamp: 2024-01-15 10:30:15.234 UTC                     │
│  Duration: 450ms                                            │
│                                                             │
│  Source: OpenAI format, /v1/chat/completions               │
│  Model Requested: gpt-4o                                    │
│  Routed To: openai / gpt-4o                                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ REQUEST BODY                                        │   │
│  │ {                                                   │   │
│  │   "model": "gpt-4o",                               │   │
│  │   "messages": [...],                               │   │
│  │   "temperature": 0.7                                │   │
│  │ }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ RESPONSE BODY                                       │   │
│  │ {                                                   │   │
│  │   "choices": [...],                                 │   │
│  │   "usage": {                                        │   │
│  │     "prompt_tokens": 10,                           │   │
│  │     "completion_tokens": 20                        │   │
│  │   }                                                 │   │
│  │ }                                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                     [📋 Copy JSON] [🔄 Replay]              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 6. Backups

**Purpose**: View and restore previous configurations.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  💾 Backups                                 [+ Create Backup]│
│  Manage and restore previous configurations                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📄 Available Backups (23)                           │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │                                                      │   │
│  │  config-backup-2024-01-15T10-30-00.yaml            │   │
│  │  Created: Jan 15, 2024 at 10:30 AM (2.1 KB)        │   │
│  │  [🔄 Restore] [🗑️ Delete]                          │   │
│  │                                                      │   │
│  │  config-backup-2024-01-15T09-15-00.yaml            │   │
│  │  Created: Jan 15, 2024 at 9:15 AM (2.0 KB)         │   │
│  │  [🔄 Restore] [🗑️ Delete]                          │   │
│  │                                                      │   │
│  │  config-backup-2024-01-14T16-45-00.yaml            │   │
│  │  Created: Jan 14, 2024 at 4:45 PM (1.9 KB)         │   │
│  │  [🔄 Restore] [🗑️ Delete]                          │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  💡 Backups are created automatically on every config change │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Restore Confirmation

```
┌────────────────────────────────────────────┐
│  ⚠️ Confirm Restore                        │
├────────────────────────────────────────────┤
│                                            │
│  You are about to restore:                 │
│  config-backup-2024-01-15T09-15-00.yaml   │
│                                            │
│  This will:                                │
│  • Replace your current configuration      │
│  • A backup of current config will be made │
│  • Changes take effect immediately         │
│                                            │
│  [✓ Yes, Restore] [Cancel]                 │
│                                            │
└────────────────────────────────────────────┘
```

---

### 7. Configuration (Raw YAML)

**Purpose**: Direct YAML editing for advanced users.

#### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ Configuration                            [Save] [Reset] │
│  Edit raw YAML configuration                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1 │ # API Map Configuration                        │   │
│  │  2 │ server:                                        │   │
│  │  3 │   port: 3000                                   │   │
│  │  4 │   host: "0.0.0.0"                              │   │
│  │  5 │                                                │   │
│  │  6 │ providers:                                     │   │
│  │  7 │   openai:                                      │   │
│  │  8 │     baseUrl: https://api.openai.com/v1         │   │
│  │  9 │     apiKeyEnv: OPENAI_API_KEY                  │   │
│  │    │                                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Validation: ✅ Valid YAML                                  │
│                                                             │
│  [💾 Download] [📤 Upload]                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Auto-Save Behavior

### What Auto-Saves

| Action | Auto-Save? | Creates Backup? |
|--------|-----------|-----------------|
| Add/Edit provider | ✅ Yes | ✅ Yes |
| Add/Edit route | ✅ Yes | ✅ Yes |
| Change default provider | ✅ Yes | ✅ Yes |
| Edit raw YAML | Manual save | N/A |
| Test model | ❌ No (no config change) | ❌ No |
| View logs | ❌ No | ❌ No |

### Save Feedback

```
┌────────────────────────────────────────┐
│  ✅ Saved successfully                 │  ← Green, fades after 3s
│  💾 Backup created: 10:30:15          │
└────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  ❌ Save failed                        │  ← Red, stays until dismissed
│  Invalid API key format               │
└────────────────────────────────────────┘
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Enter` | Send test message |
| `Cmd/Ctrl + S` | Save current form |
| `Cmd/Ctrl + Shift + R` | Refresh data |
| `Esc` | Close modal / Cancel edit |

---

## Mobile Adaptations

On narrow screens:
- Sidebar becomes hamburger menu
- Stats cards stack vertically
- Two-column layouts become single column
- Full-width action buttons
- Simplified log entries (expand for details)

---

## Error States

### Connection Lost

```
┌────────────────────────────────────────┐
│  ⚠️ Connection Lost                    │
│                                        │
│  Cannot connect to API Map server      │
│  at http://localhost:3000              │
│                                        │
│  [🔄 Retry] [⚙️ Settings]              │
└────────────────────────────────────────┘
```

### Validation Error

```
┌────────────────────────────────────────┐
│  Pattern: [gpt 4*            ]         │
│  ⚠️ Invalid: spaces not allowed       │
└────────────────────────────────────────┘
```

---

## Real-Time Updates

The GUI maintains a WebSocket or polling connection for:
- Dashboard stats (5 second refresh)
- New unrouted requests (immediate)
- Server status changes (immediate)

Status indicator in header:
- 🟢 Connected
- 🟡 Reconnecting...
- 🔴 Disconnected
