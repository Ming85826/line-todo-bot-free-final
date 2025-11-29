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
/**
 * 取得發送者在當前對話中的名稱 (用於顯示誰在執行/完成任務)
 * @param {object} event - Line 訊息事件物件
 * @returns {Promise<object>} 包含 displayName 的 Promise
 */
// 請用這段程式碼完整替換您檔案中的 async function getSenderProfile(event) 函式

/**
 * 取得發送者在當前對話中的名稱 (用於顯示誰在執行/完成任務)
 * @param {object} event - Line 訊息事件物件
 * @returns {Promise<object>} 包含 displayName 的 Promise
 */
async function getSenderProfile(event) {
    const userId = event.source.userId;
    const source = event.source;

    try {
        if (source.type === 'user') {
            // 個人聊天: 最穩定
            const profile = await client.getProfile(userId);
            return { displayName: profile.displayName };
        } else if (source.type === 'group') {
            // 群組聊天: 可能失敗，使用 try-catch
            try {
                const profile = await client.getGroupMemberProfile(source.groupId, userId);
                return { displayName: profile.displayName };
            } catch (e) {
                console.error("無法取得群組成員名稱，可能是非好友或權限不足:", e);
            }
        } else if (source.type === 'room') {
            // 聊天室: 可能失敗，使用 try-catch
            try {
                const profile = await client.getRoomMemberProfile(source.roomId, userId);
                return { displayName: profile.displayName };
            } catch (e) {
                console.error("無法取得聊天室成員名稱，可能是非好友或權限不足:", e);
            }
        }
    } catch (e) {
        // 頂層錯誤捕捉，例如 client.getProfile 網路錯誤
        console.error("頂層 Profile 錯誤:", e);
    }
    // 如果 Line API 失敗，則回傳 '未知成員'，讓 Bot 程式繼續運行
    return { displayName: '未知成員' }; 
}
// 6. 核心事件處理函式 (MongoDB 邏輯)
// 請用這段程式碼完整替換您檔案中的 async function handleEvent(event) 函式
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const conversationId = getConversationId(event);
    const messageText = event.message.text.trim();
    const lowerCaseText = messageText.toLowerCase();
    
    // 取得當前發送者的名稱
    // const senderProfile = await getSenderProfile(event); // 註解掉耗時的 Line API 呼叫
    const senderName = "測試員"; // 使用固定的名稱代替
    // const senderName = senderProfile.displayName; // 請移除或註解此行
    // ... 確保這裡只有一行 const senderName = "測試員";

    try {
        const db = await getDB();
        const collection = db.collection('todo_lists');

        let listDoc = await collection.findOne({ _id: conversationId });
        let tasks = listDoc ? listDoc.tasks : [];

        // --- ADD 邏輯 (支援指派: add 任務內容 @名稱) ---
        if (lowerCaseText.startsWith('add ')) {
            const fullContent = messageText.substring(4).trim();
            const assigneeMatch = fullContent.match(/@(\S+)/);
            
            let taskContent = fullContent;
            let assigneeName = null;

            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim(); // 取得 @ 後面的名稱
                // 移除 @名稱 從任務內容中
                taskContent = fullContent.replace(assigneeMatch[0], '').trim();
            }

            if (taskContent) {
                const newTask = {
                    content: taskContent,
                    timestamp: new Date(),
                    status: 'pending', // 待辦
                    assigneeName: assigneeName, // 指派的成員名稱
                    executorName: null, 
                    completedByName: null,
                    startTime: null,
                    endTime: null,
                };
                tasks.push(newTask);

                await collection.updateOne(
                    { _id: conversationId },
                    { $set: { tasks: tasks } },
                    { upsert: true }
                );
                
                let reply = `✅ 已新增待辦事項: "${taskContent}"`;
                if (assigneeName) {
                    reply += `\n👤 已指派給 ${assigneeName}。`;
                }

                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: reply
                });
            }
        } 
        
        // --- START 邏輯 (標註執行中並開始計時) ---
        else if (lowerCaseText.startsWith('start ')) {
            const parts = lowerCaseText.split(' ');
            const taskNumber = parseInt(parts[1], 10);

            // 過濾出未完成 (pending) 的任務
            const pendingTasks = tasks.filter(task => task.status === 'pending');
            const targetTask = pendingTasks[taskNumber - 1];

            if (!targetTask) {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '請輸入有效的「待辦中」項目編號 (例如: start 1)'
                });
            }
            
            // 在原始 tasks 陣列中找到目標任務的索引
            const originalIndex = tasks.findIndex(task => task.content === targetTask.content && task.status === 'pending');
            
            // 更新狀態與時間
            tasks[originalIndex].status = 'executing'; // 設為執行中
            tasks[originalIndex].startTime = new Date(); // 紀錄開始時間
            tasks[originalIndex].executorName = senderName; // 紀錄執行人
            
            await collection.updateOne(
                { _id: conversationId },
                { $set: { tasks: tasks } }
            );

            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `▶️ 項目 #${taskNumber} "${targetTask.content}" 已被 ${senderName} 標記為「執行中」並開始計時！`
            });
        }
        
        // --- DONE 邏輯 (標註完成，計算花費時間) ---
        else if (lowerCaseText.startsWith('done ')) {
            const parts = lowerCaseText.split(' ');
            const taskNumber = parseInt(parts[1], 10);

            // 過濾出正在執行 (executing) 或待辦 (pending) 的任務
            const activeTasks = tasks.filter(task => task.status === 'pending' || task.status === 'executing');
            const targetTask = activeTasks[taskNumber - 1];

            if (!targetTask) {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '請輸入有效的「執行中」或「待辦中」項目編號 (例如: done 1)'
                });
            }
            
            // 在原始 tasks 陣列中找到目標任務的索引
            const originalIndex = tasks.findIndex(task => task.content === targetTask.content && (task.status === 'pending' || task.status === 'executing'));
            
            // 更新狀態與時間
            tasks[originalIndex].status = 'done'; // 設為完成
            tasks[originalIndex].endTime = new Date(); // 紀錄完成時間
            tasks[originalIndex].completedByName = senderName; // 紀錄完成人
            
            await collection.updateOne(
                { _id: conversationId },
                { $set: { tasks: tasks } }
            );
            
            let timeSpentMessage = "";
            if (targetTask.startTime) {
                const durationMs = tasks[originalIndex].endTime.getTime() - targetTask.startTime.getTime();
                const totalSeconds = Math.round(durationMs / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                timeSpentMessage = `\n⏱️ 花費時間: ${minutes} 分 ${seconds} 秒。`;
            }

            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: `✅ 項目 #${taskNumber} "${targetTask.content}" 已由 ${senderName} 完成。${timeSpentMessage}`
            });
        }
        
        // --- LIST 邏輯 (顯示執行中與指派人) ---
        else if (lowerCaseText === 'list') {
            const pendingTasks = tasks.filter(task => task.status === 'pending');
            const executingTasks = tasks.filter(task => task.status === 'executing');
            const allActiveTasks = [...pendingTasks, ...executingTasks];

            if (allActiveTasks.length === 0) {
                return client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '目前待辦/執行清單是空的！'
                });
            }

            let replyText = '📜 群組待辦清單：\n\n';
            let taskIndex = 0;
            
            // 顯示執行中的任務
            if (executingTasks.length > 0) {
                replyText += '🔥 執行中：\n';
                executingTasks.forEach((task) => {
                    taskIndex++;
                    const assignee = task.assigneeName ? `(@${task.assigneeName})` : '';
                    const executor = task.executorName ? `[由 ${task.executorName} 執行中]` : '';
                    replyText += `#${taskIndex}: ${task.content} ${assignee} ${executor}\n`;
                });
                replyText += '\n';
            }

            // 顯示待辦的任務
            if (pendingTasks.length > 0) {
                replyText += '⏳ 待辦中：\n';
                pendingTasks.forEach((task) => {
                    taskIndex++;
                    const assignee = task.assigneeName ? `(@${task.assigneeName})` : '';
                    replyText += `#${taskIndex}: ${task.content} ${assignee}\n`;
                });
                replyText += '\n';
            }
            
            replyText += "輸入 'start 編號' 或 'done 編號' 來更新狀態。";
            
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: replyText
            });

        } 
        
        // --- HELP 邏輯 ---
        else if (lowerCaseText === 'help') {
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: "✨ Todo Bot (協作版) 指令：\n\n1. add [內容] @[人名]：新增任務並指派。\n2. list：顯示所有待辦及執行中事項。\n3. start [編號]：標記事項為「執行中」並開始計時。\n4. done [編號]：標記事項為「完成」並計算花費時間。\n5. clear done：清除所有已完成的項目 (下一階段開發)。\n6. help：顯示此幫助訊息。"
            });
        }
        
    } catch (error) {
        console.error(`處理事件時發生錯誤 (${conversationId}):`, error);
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `Line Bot 內部發生錯誤，請稍後再試。錯誤訊息: ${error.message}`
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