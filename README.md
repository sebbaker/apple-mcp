# Apple MCP Tools

## Prerequisites

- **Bun:** This project uses Bun as its JavaScript runtime. If you don't have it installed, you can install it by following the instructions on the [official Bun website](https://bun.sh/).

- **Git:** To clone the repository.

## Installation

1.  **Clone the Repository:**
    Open your terminal and navigate to the directory where you want to store the project. Then, clone the repository:

    ```bash
    git clone https://github.com/sebbaker/apple-mcp.git
    ```

2.  **Navigate to Project Directory:**

    ```bash
    cd apple-mcp
    ```

3.  **Install Dependencies:**
    Use Bun to install the necessary dependencies:
    ```bash
    bun install
    ```

## Configuration with Claude Desktop

To use these tools with Claude Desktop (or a similar MCP-compatible client), you need to configure it to run this server.

1.  **Find your Claude Desktop configuration file.**
    This is typically located at:

    - macOS: `~/Library/Application Support/claude-desktop-app/claude_desktop_config.json`
    - Windows: `%APPDATA%\claude-desktop-app\claude_desktop_config.json`
    - Linux: `~/.config/claude-desktop-app/claude_desktop_config.json`

2.  **Edit the configuration file.**
    Add or update the `mcpServers` section to include a definition for `apple-mcp`. You'll need to replace `/path/to/apple-mcp/index.ts` with the **absolute path** to the `index.ts` file within your cloned `apple-mcp` directory.

    Here's an example snippet to add:

    ```json
    {
      "mcpServers": {
        "apple-mcp": {
          "command": "bun",
          "args": ["run", "/path/to/apple-mcp/index.ts"]
        }
        // ... any other servers you might have configured
      }
      // ... other configurations
    }
    ```

    **Important:** Make sure `/path/to/apple-mcp/index.ts` is the correct, full path to the `index.ts` file in the directory where you cloned the `apple-mcp` repository. For example, if you cloned it into `/Users/yourname/dev/apple-mcp`, the path would be `/Users/yourname/dev/apple-mcp/index.ts`.

3.  **Restart Claude Desktop.**
    After saving the configuration file, restart Claude Desktop for the changes to take effect.

## Features

Currently, the primary focus is on interacting with the **Apple Mail** application.

### Mail Tool (`mail`)

- **Create Draft Emails:**
  - Compose new email drafts.
  - Create replies to existing emails (requires `originalMessageId`).
  - Optionally include `toAddress`, `subject`, `body`, and an `attachmentPath`.
- **List Emails:**
  - Fetch emails from specified accounts and mailboxes.
  - Defaults to 'Inbox' across all accounts if `mailboxName` is not provided.
  - Filter emails by:
    - `searchTerm` (searches subject and sender).
    - `isRead` status (boolean).
    - `isFlagged` status (boolean).
  - Limit the number of results (`limit`, defaults to 25).
  - Results are sorted by date (newest first).
  - Fetches emails from multiple mailboxes in parallel for improved performance.
- **Read Email:**
  - Retrieve the full content of a specific email using its `messageId`.
- **Move Email:**
  - Move an email (specified by `messageId`) to a `targetMailboxName`.
  - Optionally specify `targetAccountName` if the mailbox name isn't unique.
- **List Mailboxes:**
  - List all available mailboxes, prefixed with their account name (e.g., "iCloud/Inbox").
  - Optionally filter mailboxes by `accountName`.

## Usage Example (with Claude)

Once configured, you can ask Claude to use the `apple-mcp` tool. For example:

```
Using the apple-mcp tool, list my 5 most recent unread emails from my 'Work' account inbox.
```

```
Using the apple-mcp tool, create a draft email to "example@example.com" with the subject "Meeting Follow-up" and body "Hi team, just following up on our meeting."
```

## Local Development & Running Manually

If you want to run the server manually for testing or development:

1.  Navigate to the project directory:
    ```bash
    cd apple-mcp
    ```
2.  Run the server:
    ```bash
    bun run index.ts
    ```
    The server will start and listen for MCP requests via stdio.
