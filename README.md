# General-Purpose MySQL MCP Server

  [![TypeScript](https://img.shields.io/badge/TypeScript-black?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-black?style=for-the-badge&logo=nodedotjs&logoColor=339933)](https://nodejs.org/)
  [![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue?style=for-the-badge)](https://modelcontextprotocol.io/)
  [![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)](https://www.mysql.com/)

  This repository contains a general-purpose, secure, and efficient **Model Context Protocol (MCP)** server for MySQL databases. It acts as a secure bridge, allowing AI agents and applications (MCP Clients) to interact with any MySQL database without needing direct credentials.

  This server is designed to be a standalone, reusable component. It was originally developed for the [EventScribe AI](https://github.com/AbeqqalMarouane/PromptEnhancing_UsingMCP) project but can be used by any MCP-compatible client.

  ## ✨ Key Features

  - **High Performance**: Uses a MySQL connection pool for efficient, high-concurrency database interactions suitable for production environments.
  - **Database Agnostic**: While using the `mysql2` driver, the server's logic and configuration via environment variables allow it to connect to any MySQL-compatible database (local, cloud-based, or containerized).
  - **Graceful Shutdown**: Includes logic to cleanly close database connections when the server process is terminated.

  ## 🏗️ Architecture: The Server's Role

  This MCP server is the "Data Layer" in a modern agentic architecture. The client (e.g., a Next.js application) orchestrates the workflow, while this server is the only component with direct access to the database.

  ```mermaid
graph TD
    subgraph "Client's Responsibility (e.g., EventScribe AI)"
        A["Client Application"]
        A -- "Starts & Manages Process" --> B
        A -- "Sends 'Get Schema' Request" --> B
        A -- "Sends 'Run Query' Request" --> B
    end

    subgraph "Server's Responsibility (This Project)"
        B["MySQL MCP Server"]
        B -- "Manages Connection Pool" --> C[(MySQL Database)]
        B -- "Executes SHOW CREATE TABLE" --> C
        B -- "Executes safe SELECT query" --> C
        C -- "Returns SQL Results" --> B
    end

    B -- "Returns Schema as Resource" --> A
    B -- "Returns Query Data as Tool Result" --> A
```

  ## 🚀 Getting Started

  ### Prerequisites
  - Node.js 18+
  - A running MySQL 8.0+ database instance.

  ### Installation & Setup

  1. Clone the repository:
  ```bash
  git clone https://github.com/AbeqqalMarouane/MySQL-MCP-Server.git
  cd MySQL-MCP-Server
  ```

  2. Install dependencies:
  ```bash
  npm install
  ```

  3. Set up environment variables:
     - Create a `.env` file in the root of the project:
  
     - Then, edit the `.env` file with your database credentials:
  ```env
  # In MySQL-MCP-Server/.env
  DB_HOST=localhost
  DB_USER=root
  DB_PASSWORD=your_mysql_password
  DB_NAME=your_database_name
  DB_PORT=3306
  ```

  4. Build the TypeScript code:
  ```bash
  npm run build
  ```
  This compiles the `src/index.ts` file into a runnable JavaScript file in the `build/` directory.

  ## 🛠️ Usage

  This server is designed to be launched and controlled by an MCP client.

  ### 1. Testing with MCP Inspector
  The easiest way to test the server is with the official MCP Inspector tool. From the project's root directory, run:
  ```bash
  npx -- @modelcontextprotocol/inspector npm start
  ```
  This will launch the Inspector UI in your browser, where you can directly interact with the server's resources and tools.

  ### 2. Integrating with a Programmatic Client
  To use this server in your own application (like a Next.js API route), configure your client's `StdioClientTransport` to run the server's `npm start` command.

  Example Client Configuration:
  ```javascript
  // In your client application code
  const transport = new StdioClientTransport({
    command: "npm",
    args: ["start"],
    cwd: "/path/to/your/MySQL-MCP-Server" // Absolute path to this project
  });
  ```

  ## 📖 Exposed MCP Capabilities

  This server exposes two primary capabilities to any connected client.

  ### Resource: schema
  - **URI**: `mysql://schemas`
  - **Description**: Returns the full `CREATE TABLE` SQL statements for all tables in the connected database. This allows an AI agent to learn the complete structure of the database.
  - **Usage (in a client)**: `mcpClient.readResource({ uri: "mysql://schemas" })`

  ### Tool: read_only_query
  - **Name**: `read_only_query`
  - **Description**: Executes a SQL query against the database.
  - **Input Schema**: `{ sql: string }`
  - **Security**: The tool contains a vital security check. It will only execute queries that begin with `SELECT`. Any other command (`UPDATE`, `DELETE`, `INSERT`, `DROP`, etc.) will be rejected with an error.
  - **Usage (in a client)**: `mcpClient.callTool({ name: "read_only_query", arguments: { sql: "SELECT * FROM events LIMIT 10" } })`

  ## 🤝 Contributing

  Contributions are welcome! If you have ideas for improvements or find a bug, please feel free to:
  - Fork the repository.
  - Create a new feature branch (`git checkout -b feature/your-amazing-feature`).
  - Make your changes.
  - Submit a pull request with a clear description of your changes.

  ## 📄 License

  This project is licensed under the MIT License.
```
