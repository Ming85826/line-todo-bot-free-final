// api/webhook.js

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');

// (1) 待辦事項儲存區 (⚠️ 注意: 在 Serverless 環境中，資料在每次函式呼叫後可能被清除，
//     但為了教學目的，我們先用這個 in-memory 儲存結構來實作功能)
const todoList = {}; // 結構: { userId: ['Todo item 1', 'Todo item 2'], ... }

// 從 Vercel 環境變數讀取憑證
const lineConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

const lineClient = new Client(lineConfig);
const app = express();


// (2) 處理 Line 發送的單一事件 (已修改為處理 Todo 邏輯)
function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userId = event.source.userId;
    const userText = event.message.text.trim();
    let replyText = '';
    
    // 確保該使用者有清單
    if (!todoList[userId]) {
        todoList[userId] = [];
    }
    
    // ====== 待辦事項邏輯判斷 ======

    if (userText.toLowerCase().startsWith('+')) {
        // 新增待辦事項: + 吃飯
        const todoItem = userText.substring(1).trim();
        if (todoItem) {
            todoList[userId].push(todoItem);
            replyText = `✅ 已新增待辦事項: "${todoItem}"`;
        } else {
            replyText = '請在 "+" 號後輸入待辦事項內容。';
        }
    } else if (userText.toLowerCase() === 'list') {
        // 顯示清單: list
        if (todoList[userId].length === 0) {
            replyText = '您的待辦清單目前是空的！';
        } else {
            const listItems = todoList[userId].map((item, index) => `${index + 1}. ${item}`).join('\n');
            replyText = `📝 您的待辦清單：\n${listItems}`;
        }
    } else {
        // 預設回覆，引導使用者
        replyText = `請輸入指令：\n  1. 新增事項：+ 事項內容\n  2. 查看清單：list`;
    }

    // ====== 待辦事項邏輯判斷 結束 ======


    return lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: replyText
    });
}

// (3) Webhook 接收路由 (已修正為 Vercel 結構)
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