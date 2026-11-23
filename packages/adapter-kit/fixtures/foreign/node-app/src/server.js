import express from "express";

const app = express();

app.get("/tides", (_req, res) => res.json([]));
app.listen(3000);
