// api/webhook.js

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');

// 從 Vercel 環境變數讀取憑證
const lineConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const lineClient = new Client(lineConfig);
const app = express();

// 處理 Line 發送的單一事件
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    // 這是您的回覆邏輯 (待辦事項功能將在這裡實現)
    const replyText = `[新開始] 您說了: ${event.message.text}。Webhook 運作正常！`;

    return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: replyText
    });
}

// Webhook 接收路由 (Vercel 將此檔案視為一個函式)
app.post('/api/webhook', middleware(lineConfig), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

module.exports = app;