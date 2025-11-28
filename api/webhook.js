// ===============================================
// MongoDB 整合版本: api/webhook.js
// Vercel Serverless Function
// ===============================================

// 1. 引入必要的套件與設定
require('dotenv').config({ path: './env.local' });
const { Client } = require('@line/bot-sdk');
const { MongoClient, ServerApiVersion } = require('mongodb');

// 2. Line Bot 設定
const lineConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new Client(lineConfig); // 使用 client 作為 Line Bot 客戶端

// 3. MongoDB 連線設定
const uri = process.env.MONGODB_URI;
const mongoClient = new MongoClient(uri, { // 使用 mongoClient 作為 MongoDB 客戶端
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// 4. 連線資料庫函式
async function getDB() {
    if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
        console.log("Connecting to MongoDB...");
        await mongoClient.connect();
        console.log("MongoDB connected successfully.");
    }
    return mongoClient.db("linebot_db"); 
}

// 5. 取得對話 ID 函式 (支援群組/個人)
function getConversationId(event) {
    if (event.source.groupId) {
        return event.source.groupId;
    }
    if (event.source.roomId) {
        return event.source.roomId;
    }
    return event.source.userId;
}

// 6. 核心事件處理函式 (MongoDB 邏輯)
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const conversationId = getConversationId(event);
    const messageText = event.message.text.trim().toLowerCase();
    
    try {
        const db = await getDB();
        const collection = db.collection('todo_lists');

        let listDoc = await collection.findOne({ _id: conversationId });
        let tasks = listDoc ? listDoc.tasks : [];

        // --- ADD 邏輯 ---
        if (messageText.startsWith('add ')) {
            const taskContent = event.message.text.substring(4).trim();
            if (taskContent) {
                const newTask = {
                    content: taskContent,
                    timestamp: new Date(),
                    status: 'pending'
                };
                tasks.push(newTask);

                await collection.updateOne(
                    { _id: conversationId },
                    { $set: { tasks: tasks } },
                    { upsert: true }
                );

                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `✅ 已新增待辦事項: ${taskContent}`
                });
            }
        } 
        
        // --- LIST 邏輯 ---
        else if (messageText === 'list') {
            const pendingTasks = tasks.filter(task => task.status === 'pending');
            
            if (pendingTasks.length === 0) {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: (tasks.length === 0) ? '目前待辦清單是空的！' : '所有待辦事項都已完成！'
                });
            }
            
            const listItems = pendingTasks
                .map((task, index) => `#${index + 1}: ${task.content}`)
                .join('\n');
            
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `📜 待辦清單：\n${listItems}\n\n輸入 'done 項目編號' 來完成待辦事項。`
            });

        } 
        
        // --- DONE 邏輯 ---
        else if (messageText.startsWith('done ')) {
            const parts = messageText.split(' ');
            const taskNumber = parseInt(parts[1], 10);

            const pendingTasks = tasks.filter(task => task.status === 'pending');
            const targetTask = pendingTasks[taskNumber - 1];

            if (!targetTask) {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '請輸入有效的待辦項目編號 (例如: done 1)'
                });
            }

            const originalIndex = tasks.findIndex(task => task.content === targetTask.content && task.status === 'pending');
            tasks[originalIndex].status = 'done';
            
            await collection.updateOne(
                { _id: conversationId },
                { $set: { tasks: tasks } }
            );

            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `✅ 項目 #${taskNumber} "${targetTask.content}" 已標記為完成。`
            });
            
        } 
        
        // --- HELP 邏輯 ---
        else if (messageText === 'help') {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: "Todo Bot 指令：\n1. add [任務內容]：新增待辦事項。\n2. list：顯示所有未完成事項。\n3. done [編號]：標記未完成清單中的項目為完成。\n4. help：顯示此幫助訊息。"
            });
        }
        
    } catch (error) {
        console.error(`處理事件時發生錯誤 (${conversationId}):`, error);
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'Line Bot 內部發生錯誤，請稍後再試。'
        });
    }
    return null;
}

// 7. Vercel 輸出 Handler (取代 module.exports = app;)
module.exports.handler = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }
    
    const signature = req.headers['x-line-signature'];
    const body = req.body;
    
    try {
        if (!client.validateSignature(JSON.stringify(body), signature)) {
            console.log('Invalid signature');
            return res.status(400).send('Invalid signature');
        }
    } catch (error) {
        return res.status(400).send('Invalid body');
    }
    
    const events = body.events;
    
    try {
        await Promise.all(events.map(handleEvent));
        res.json({ success: true });
    } catch (error) {
        console.error('Handler Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};