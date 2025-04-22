const express = require("express");
const app = express();
const axios = require("axios");
require("dotenv").config(); // Add this to properly load .env file

const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const ACTIONS = require("./src/actions/Actions");

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(express.static("build"));
app.use((req, res, next) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

// Judge0 API configuration
const JUDGE0_API = "https://judge0-ce.p.rapidapi.com";
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY;

// Verify API key is loaded
console.log("Environment Check:");
console.log("API Key loaded:", !!JUDGE0_API_KEY);
console.log("API Key length:", JUDGE0_API_KEY?.length);

async function executeCode(language_id, source_code) {
  try {
    console.log("Executing code with language_id:", language_id);

    const headers = {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": JUDGE0_API_KEY,
      "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
    };

    // Log the request details (without the full API key)
    console.log("Request details:", {
      url: `${JUDGE0_API}/submissions`,
      languageId: language_id,
      headerKeys: Object.keys(headers),
      codeLength: source_code.length,
    });

    // Submit the code
    const submitResponse = await axios({
      method: "post",
      url: `${JUDGE0_API}/submissions`,
      headers: headers,
      data: {
        source_code: source_code,
        language_id: language_id,
        stdin: "",
      },
    });

    console.log("Submission successful, token:", submitResponse.data.token);

    // Wait for the code to execute
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get the result
    const resultResponse = await axios({
      method: "get",
      url: `${JUDGE0_API}/submissions/${submitResponse.data.token}`,
      headers: headers,
    });

    console.log("Execution result:", {
      status: resultResponse.data.status,
      stdout: resultResponse.data.stdout,
      stderr: resultResponse.data.stderr,
    });

    return resultResponse.data;
  } catch (error) {
    console.error("Execution error details:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers,
    });

    return {
      status: { description: "Error" },
      stderr: error.response?.data?.error || error.message,
      stdout: "",
      compile_output: "",
    };
  }
}

const userSocketMap = {};
function getAllConnectedClients(roomId) {
  // Map
  return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
    (socketId) => {
      return {
        socketId,
        username: userSocketMap[socketId],
      };
    }
  );
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
    userSocketMap[socket.id] = username;
    socket.join(roomId);
    const clients = getAllConnectedClients(roomId);
    clients.forEach(({ socketId }) => {
      io.to(socketId).emit(ACTIONS.JOINED, {
        clients,
        username,
        socketId: socket.id,
      });
    });
  });

  socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
    socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
    io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
  });

  socket.on(ACTIONS.CODE_RUN, async ({ code, language_id, roomId }) => {
    console.log("Received code run request:", {
      languageId: language_id,
      roomId: roomId,
      codeLength: code.length,
    });

    try {
      const result = await executeCode(language_id, code);
      io.to(roomId).emit(ACTIONS.CODE_OUTPUT, {
        output: result.stdout || result.compile_output || result.stderr,
        status: result.status?.description || "Unknown",
      });
    } catch (error) {
      console.error("Code run error:", error);
      io.to(roomId).emit(ACTIONS.CODE_OUTPUT, {
        output: "Error executing code: " + error.message,
        status: "Error",
      });
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    rooms.forEach((roomId) => {
      socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
        socketId: socket.id,
        username: userSocketMap[socket.id],
      });
    });
    delete userSocketMap[socket.id];
    socket.leave();
  });
});

// Serve response in production
app.get("/", (req, res) => {
  const htmlContent = "<h1>Welcome to the code editor server</h1>";
  res.setHeader("Content-Type", "text/html");
  res.send(htmlContent);
});

const PORT = process.env.SERVER_PORT || 5000;
server.listen(PORT, "0.0.0.0", () => console.log(`Listening on port ${PORT}`));
