// ===============================================
// MongoDB 整合版本: api/webhook.js
// Vercel Serverless Function - 最終修復版本
// ===============================================

// 1. 引入必要的套件與設定 (已移除 dotenv，使用 Vercel 環境變數)
const { Client } = require('@line/bot-sdk');
const { MongoClient, ServerApiVersion } = require('mongodb');

// 2. Line Bot 設定
const lineConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};
const client = new Client(lineConfig); 

// 3. MongoDB 連線設定
// 注意：如果您的 MONGODB_URI 變數未正確載入，服務會在這裡崩潰。
const uri = process.env.MONGODB_URI;
// 這裡僅在 URI 存在時初始化 MongoClient，避免在 URI 為 undefined 時崩潰
const mongoClient = uri ? new MongoClient(uri, { 
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
}) : null;

// 4. 連線資料庫函式
async function getDB() {
    if (!mongoClient) {
        throw new Error("MongoDB Client not initialized. Check MONGODB_URI environment variable.");
    }
    // 檢查連線狀態，如果未連線或 topology 錯誤則重新連線
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
 * 取得發送者在當前對話中的名稱
 */
async function getSenderProfile(event) {
    const userId = event.source.userId;
    const source = event.source;

    try {
        // ... (保持原有的 getSenderProfile 邏輯，但在 handleEvent 中已註解不用)
    } catch (e) {
        console.error("頂層 Profile 錯誤:", e);
    }
    return { displayName: '未知成員' }; 
}

// 臨時測試函式：確認 MongoDB URI 是否被正確載入
async function checkMongoURI() {
    const uri = process.env.MONGODB_URI;
    // 檢查 URI 是否存在，或是否仍包含預留的 <db_password>
    if (!uri || uri.includes('<db_password>')) {
        console.error("MongoDB URI NOT LOADED OR NOT CONFIGURED!");
        return "URI_ERROR";
    }
    return "URI_OK";
}

// 6. 核心事件處理函式 (MongoDB 邏輯)
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const conversationId = getConversationId(event);
    const messageText = event.message.text.trim();
    const lowerCaseText = messageText.toLowerCase();
    
    // 取得當前發送者的名稱 (暫時使用固定名稱，避免 Line API 超時)
    // const senderProfile = await getSenderProfile(event); 
    const senderName = "測試員"; // 使用固定的名稱代替

    try {
        const db = await getDB(); // 這裡會觸發 MongoDB 連線
        const collection = db.collection('todo_lists');

        let listDoc = await collection.findOne({ _id: conversationId });
        let tasks = listDoc ? listDoc.tasks : [];

        // --- ADD 邏輯 ---
        if (lowerCaseText.startsWith('add ')) {
            // ... (保持原有的 ADD 邏輯)
            const fullContent = messageText.substring(4).trim();
            const assigneeMatch = fullContent.match(/@(\S+)/);
            
            let taskContent = fullContent;
            let assigneeName = null;

            if (assigneeMatch) {
                assigneeName = assigneeMatch[1].trim(); 
                taskContent = fullContent.replace(assigneeMatch[0], '').trim();
            }

            if (taskContent) {
                const newTask = {
                    content: taskContent,
                    timestamp: new Date(),
                    status: 'pending', 
                    assigneeName: assigneeName, 
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
        
        // --- START/DONE/LIST/HELP 邏輯 ---
        else if (lowerCaseText.startsWith('start ')) {
            // ... (保持原有的 START 邏輯)
            const parts = lowerCaseText.split(' ');
            const taskNumber = parseInt(parts[1], 10);
            const pendingTasks = tasks.filter(task => task.status === 'pending');
            const targetTask = pendingTasks[taskNumber - 1];

            if (!targetTask) {
                return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入有效的「待辦中」項目編號 (例如: start 1)' });
            }
            
            const originalIndex = tasks.findIndex(task => task.content === targetTask.content && task.status === 'pending');
            tasks[originalIndex].status = 'executing'; 
            tasks[originalIndex].startTime = new Date(); 
            tasks[originalIndex].executorName = senderName; 
            
            await collection.updateOne({ _id: conversationId }, { $set: { tasks: tasks } });

            return client.replyMessage(event.replyToken, { type: 'text', text: `▶️ 項目 #${taskNumber} "${targetTask.content}" 已被 ${senderName} 標記為「執行中」並開始計時！` });

        } else if (lowerCaseText.startsWith('done ')) {
            // ... (保持原有的 DONE 邏輯)
            const parts = lowerCaseText.split(' ');
            const taskNumber = parseInt(parts[1], 10);
            const activeTasks = tasks.filter(task => task.status === 'pending' || task.status === 'executing');
            const targetTask = activeTasks[taskNumber - 1];

            if (!targetTask) {
                return client.replyMessage(event.replyToken, { type: 'text', text: '請輸入有效的「執行中」或「待辦中」項目編號 (例如: done 1)' });
            }
            
            const originalIndex = tasks.findIndex(task => task.content === targetTask.content && (task.status === 'pending' || task.status === 'executing'));
            tasks[originalIndex].status = 'done'; 
            tasks[originalIndex].endTime = new Date(); 
            tasks[originalIndex].completedByName = senderName; 
            
            await collection.updateOne({ _id: conversationId }, { $set: { tasks: tasks } });
            
            let timeSpentMessage = "";
            if (targetTask.startTime) {
                const durationMs = tasks[originalIndex].endTime.getTime() - targetTask.startTime.getTime();
                const totalSeconds = Math.round(durationMs / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                timeSpentMessage = `\n⏱️ 花費時間: ${minutes} 分 ${seconds} 秒。`;
            }

            return client.replyMessage(event.replyToken, { type: 'text', text: `✅ 項目 #${taskNumber} "${targetTask.content}" 已由 ${senderName} 完成。${timeSpentMessage}` });

        } else if (lowerCaseText === 'list') {
            // ... (保持原有的 LIST 邏輯)
            const pendingTasks = tasks.filter(task => task.status === 'pending');
            const executingTasks = tasks.filter(task => task.status === 'executing');
            const allActiveTasks = [...pendingTasks, ...executingTasks];

            if (allActiveTasks.length === 0) {
                return client.replyMessage(event.replyToken, { type: 'text', text: '目前待辦/執行清單是空的！' });
            }

            let replyText = '📜 群組待辦清單：\n\n';
            let taskIndex = 0;
            
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
            
            return client.replyMessage(event.replyToken, { type: 'text', text: replyText });

        } else if (lowerCaseText === 'help') {
            // ... (保持原有的 HELP 邏輯)
            return client.replyMessage(event.replyToken, {
                type: 'text',
                text: "✨ Todo Bot (協作版) 指令：\n\n1. add [內容] @[人名]：新增任務並指派。\n2. list：顯示所有待辦及執行中事項。\n3. start [編號]：標記事項為「執行中」並開始計時。\n4. done [編號]：標記事項為「完成」並計算花費時間。\n5. clear done：清除所有已完成的項目 (下一階段開發)。\n6. help：顯示此幫助訊息。"
            });
        }
        
    } catch (error) {
        // 捕捉 handleEvent 內部的錯誤 (例如 MongoDB 連線失敗)
        console.error(`處理事件時發生錯誤 (${conversationId}):`, error);
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `Line Bot 內部發生錯誤，請稍後再試。錯誤訊息: ${error.message}`
        });
    }
    return null;
}

// 7. Vercel 輸出 Handler (最終正確導出)
module.exports = async (req, res) => {
    // 臨時測試程式碼：強制檢查 URI
    const uriStatus = await checkMongoURI();
    if (uriStatus === "URI_ERROR") {
        // 如果 URI 錯誤，回傳 200 (成功) 並顯示錯誤訊息
        return res.status(200).send("DB_URI_CHECK_FAILED. Please check MONGODB_URI in Vercel."); 
    }
    // 臨時測試程式碼結束
    
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }
    
    const signature = req.headers['x-line-signature'];
    const body = req.body;
    
    try {
        // 簽名驗證
        if (!client.validateSignature(JSON.stringify(body), signature)) {
            console.log('Invalid signature');
            return res.status(400).send('Invalid signature'); 
        }
    } catch (error) {
        return res.status(400).send('Invalid body');
    }
    
    const events = body.events;
    
    try {
        // 如果沒有事件 (如 Webhook 驗證請求)，直接回覆 200
        if (!events || events.length === 0) {
            return res.status(200).json({ success: true, message: "No events to process" });
        }
        
        await Promise.all(events.map(handleEvent));
        res.json({ success: true });
    } catch (error) {
        console.error('Handler Error:', error);
        // 如果資料庫或其他運行時錯誤，回傳 500
        res.status(500).json({ error: 'Internal Server Error' }); 
    }
};