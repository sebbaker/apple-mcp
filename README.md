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

This MCP server provides comprehensive email management tools for **Apple Mail**. All tools work across multiple email accounts and support various mailbox types.

### Email Management Tools

#### **Create Draft Emails (`createDraft`)**
- **Compose new email drafts** with recipient, subject, body, and optional attachments
- **Create replies to existing emails** by providing the original message ID
- **Attach files** by specifying absolute file paths
- Automatically opens the draft in Apple Mail for final editing and sending

#### **List Emails (`listEmails`)**
- **Fetch emails** from specified accounts and mailboxes (defaults to Inbox across all accounts)
- **Advanced filtering options:**
  - Search by text in subject and sender
  - Filter by read/unread status
  - Filter by flagged status
  - Limit number of results (default: 25)
- **Multi-account support** with parallel fetching for improved performance
- Results sorted by date (newest first)

#### **Read Email Content (`readEmails`)**
- **Retrieve full email content** including body text for specific emails
- **Batch reading** support for multiple emails at once
- Returns complete email metadata (sender, date, read status, etc.)

#### **List Mailboxes (`listMailboxes`)**
- **Discover all available mailboxes** across all configured email accounts
- Shows mailboxes prefixed with account names (e.g., "iCloud/Inbox", "Gmail/Sent")
- Essential for identifying valid targets for move/copy operations

#### **Move Emails (`move`)**
- **Move emails between mailboxes** within the same account or across accounts
- Requires target account and mailbox names (use `listMailboxes` first)
- Validates target locations before attempting moves

#### **Copy Emails (`copy`)**
- **Duplicate emails to other mailboxes** while keeping originals in place
- Useful for organizing emails across multiple folders
- Supports cross-account copying

#### **Archive Emails (`archive`)**
- **Archive emails** using Apple Mail's built-in archiving functionality
- Works with different account types (iCloud, Gmail, Exchange, etc.)
- Automatically handles account-specific archive locations

#### **Trash Emails (`trash`)**
- **Move emails to trash** safely and efficiently
- Respects account-specific trash folder configurations

## Usage Examples (with Claude)

Once configured, you can ask Claude to perform various email management tasks:

**Listing and searching emails:**
```
Using the apple-mcp tool, list my 10 most recent unread emails from my work account.
```

**Creating drafts:**
```
Create a draft email to "team@company.com" with subject "Weekly Update" and body "Hi team, here's this week's progress update..."
```

**Email organization:**
```
Move the email with ID "ABC123" to my "Projects" folder in my work account.
```

**Reading email content:**
```
Show me the full content of the email with ID "XYZ789".
```

**Discovering mailboxes:**
```
List all my available mailboxes so I can see where to organize my emails.
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
