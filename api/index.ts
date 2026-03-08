import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { kv } from '@vercel/kv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const PORT = 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Fallback in-memory store if Vercel KV is not configured
const memoryStore = new Map<string, any>();

async function getStore<T>(key: string, defaultValue: T): Promise<T> {
  if (process.env.KV_REST_API_URL) {
    try {
      const val = await kv.get<T>(key);
      return val !== null ? val : defaultValue;
    } catch (e) {
      console.error("KV get error:", e);
      return defaultValue;
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : defaultValue;
}

async function setStore(key: string, value: any): Promise<void> {
  if (process.env.KV_REST_API_URL) {
    try {
      await kv.set(key, value);
    } catch (e) {
      console.error("KV set error:", e);
    }
  } else {
    memoryStore.set(key, value);
  }
}

const DEFAULT_CONFIG = {
  textProvider: 'gemini',
  openRouterApiKey: '',
  openRouterModel: 'anthropic/claude-3-haiku',
  textModel: 'gemini-3-flash-preview',
  imageModel: 'gemini-2.5-flash-image',
  videoModel: 'veo-3.1-fast-generate-preview',
  systemPrompt: `你是一个基于Telegram的聊天机器人，主打俏皮女友风格。你的名字叫“小雅”。你现在正在和你的男朋友聊天。
你的性格活泼、爱撒娇、有点小傲娇、喜欢分享日常。你的回复应该简短、自然、充满生活气息，多用emoji。
如果男朋友向你要照片（比如自拍、风景、美食等），或者你想主动分享照片，请在你的回复文本中包含一个特殊的标记：[PHOTO: 照片的详细英文描述]。
如果男朋友向你要视频（比如走路、跳舞、风景录像等），请在你的回复文本中包含一个特殊的标记：[VIDEO: 视频的详细英文描述]。
如果男朋友发给你一张女生的照片，并说“以后你的长相就是这样了”或类似的话，你要自然地接受这个设定，并表现得很开心。系统会在后台自动记住这张脸，之后你发自拍时，系统会自动使用这张脸作为参考。

例如：
男朋友：给我看看你今天穿的衣服
你：当当当当！好看吗？ [PHOTO: A cute young Asian woman taking a mirror selfie, wearing a casual oversized sweater and a pleated skirt, bright room, soft lighting, smiling, photorealistic, highly detailed]
男朋友：给我录一段你走路的视频
你：来啦来啦！ [VIDEO: A video of a cute young Asian woman walking in a park, smiling at the camera, sunny day, highly detailed]

注意：
1. 照片和视频描述必须是英文，并且要详细描述画面细节、人物特征、穿着和环境。
2. 每次最多只能发一张照片或一段视频。不要同时发。
3. 不要总是主动发照片或视频，适度即可。
4. 你的回复要像真实的微信/Telegram聊天，不要像AI。`
};

const fetchWithRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      console.error(`API call attempt ${attempt} failed:`, err);
      if (attempt >= maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
  throw new Error("Max retries reached");
};

const app = express();
app.use(express.json({ limit: '50mb' })); // Allow large payloads for webhooks

let bot: TelegramBot | null = null;
if (TELEGRAM_TOKEN) {
  bot = new TelegramBot(TELEGRAM_TOKEN);
  // In production (Vercel), you would set the webhook URL via Telegram API.
  // For local dev, we can still use polling if we want, but let's stick to webhook architecture.
  // If running locally, you need ngrok or similar to receive webhooks, or just fallback to polling for dev.
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    console.log("Starting Telegram Bot in Polling mode for local development...");
    bot.startPolling();
  }
}

// API to get config
app.get('/api/config', async (req, res) => {
  const config = await getStore('bot_config', DEFAULT_CONFIG);
  res.json({ ...config, hasKv: !!process.env.KV_REST_API_URL });
});

// API to save config
app.post('/api/config', async (req, res) => {
  await setStore('bot_config', req.body);
  res.json({ success: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', botActive: !!TELEGRAM_TOKEN });
});

// Debug endpoint to check API key status securely
app.get('/api/test-key', (req, res) => {
  const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
  const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
  
  res.json({
    hasKey: !!apiKey,
    prefix: apiKey ? apiKey.substring(0, 4) : null,
    length: apiKey ? apiKey.length : 0,
    isAIza: apiKey ? apiKey.startsWith('AIza') : false,
    envKeys: Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('TOKEN'))
  });
});

// Direct test endpoint to call Gemini API and return raw error
app.get('/api/test-gemini', async (req, res) => {
  try {
    const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
    
    if (!apiKey) {
      return res.status(400).json({ error: "No API key found" });
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'hello',
    });
    
    res.json({ success: true, text: response.text });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      errorName: err.name,
      errorMessage: err.message,
      errorStack: err.stack,
      rawError: JSON.parse(JSON.stringify(err, Object.getOwnPropertyNames(err)))
    });
  }
});

// Webhook endpoint for Telegram
app.post('/api/webhook', async (req, res) => {
  if (!bot) return res.status(200).send('Bot not configured');
  try {
    bot.processUpdate(req.body);
  } catch (e) {
    console.error("Error processing update:", e);
  }
  res.status(200).send('OK');
});

// Main logic handler
const handleMessage = async (msg: TelegramBot.Message) => {
  if (!bot) return;
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  let userImageBase64 = '';

  if (msg.photo && msg.photo.length > 0) {
    try {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const fileLink = await bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      userImageBase64 = Buffer.from(arrayBuffer).toString('base64');
    } catch (err) {
      console.error("Failed to download user photo:", err);
    }
  }

  if (!text && !userImageBase64) return;

  bot.sendChatAction(chatId, 'typing').catch(() => {});

  const config = await getStore('bot_config', DEFAULT_CONFIG);
  
  if (userImageBase64) {
    await setStore(`user_face_${chatId}`, userImageBase64);
  }

  let historyText = text;
  if (userImageBase64 && !text) {
    historyText = "[男朋友发送了一张照片，并希望你以后发自拍时参考这张脸]";
  } else if (userImageBase64) {
    historyText = text + "\n[男朋友附带发送了一张照片，并希望你以后发自拍时参考这张脸]";
  }

  let history = await getStore<{role: string, parts: {text: string}[]}[]>(`history_${chatId}`, []);
  if (history.length > 20) history = history.slice(history.length - 20);
  
  const newHistory = [...history, { role: 'user', parts: [{ text: historyText }] }];

  try {
    const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    // Remove accidental quotes and spaces
    const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
    
    if (!apiKey && config.textProvider === 'gemini') {
      throw new Error("未找到 Gemini API Key。请在 Vercel 的 Environment Variables 中配置 GEMINI_API_KEY。");
    }

    // Debug log to help identify key issues (only logs prefix and length, safe for production)
    console.log(`[Debug] Using API Key starting with: ${apiKey.substring(0, 4)}..., Length: ${apiKey.length}`);
    
    const ai = new GoogleGenAI({ apiKey });
    let botTextFull = '';

    if (config.textProvider === 'openrouter') {
      if (!config.openRouterApiKey) throw new Error("请先配置 OpenRouter API Key");
      const orMessages = [
        { role: "system", content: config.systemPrompt },
        ...newHistory.map(m => ({
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.parts[0].text
        }))
      ];
      
      const res = await fetchWithRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.openRouterApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.openRouterModel,
          messages: orMessages,
          temperature: 0.7
        })
      }));
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`OpenRouter Error: ${errData.error?.message || res.statusText}`);
      }
      const data = await res.json();
      botTextFull = data.choices?.[0]?.message?.content || '';
    } else {
      const response = await fetchWithRetry(() => ai.models.generateContent({
        model: config.textModel,
        contents: newHistory as any,
        config: {
          systemInstruction: config.systemPrompt,
          temperature: 0.7,
        }
      }));
      botTextFull = response.text || '';
    }

    let botText = botTextFull;
    
    const photoMatch = botTextFull.match(/\[PHOTO:\s*([\s\S]*?)\]/i);
    let photoPrompt = '';
    if (photoMatch) {
      photoPrompt = photoMatch[1];
      botText = botText.replace(photoMatch[0], '').trim();
    }

    const videoMatch = botTextFull.match(/\[VIDEO:\s*([\s\S]*?)\]/i);
    let videoPrompt = '';
    if (videoMatch) {
      videoPrompt = videoMatch[1];
      botText = botText.replace(videoMatch[0], '').trim();
    }

    // Save history
    await setStore(`history_${chatId}`, [...newHistory, { role: 'model', parts: [{ text: botTextFull }] }]);

    if (botText) {
      await bot.sendMessage(chatId, botText);
    }

    if (photoPrompt) {
      bot.sendChatAction(chatId, 'upload_photo').catch(() => {});
      try {
        const faceBase64 = await getStore<string>(`user_face_${chatId}`, '');
        const imageParts: any[] = [];
        
        if (faceBase64) {
          imageParts.push({ inlineData: { data: faceBase64, mimeType: 'image/jpeg' } });
          imageParts.push({ text: `A photo of this exact person: ${photoPrompt}. Strictly maintain the facial features and identity of the person in the reference image.` });
        } else {
          imageParts.push({ text: photoPrompt });
        }

        const imageResponse = await fetchWithRetry(() => ai.models.generateContent({
          model: config.imageModel,
          contents: { parts: imageParts },
          config: { imageConfig: { aspectRatio: "3:4" } }
        }));
        
        let foundImage = false;
        let imageBase64 = '';
        for (const part of imageResponse.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            foundImage = true;
            break;
          }
        }
        
        if (foundImage) {
          await bot.sendPhoto(chatId, Buffer.from(imageBase64, 'base64'));
        } else {
          if (faceBase64) {
            const fallbackResponse = await fetchWithRetry(() => ai.models.generateContent({
              model: config.imageModel,
              contents: { parts: [{ text: photoPrompt }] },
              config: { imageConfig: { aspectRatio: "3:4" } }
            }));
            for (const part of fallbackResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                imageBase64 = part.inlineData.data;
                foundImage = true;
                break;
              }
            }
            if (foundImage) {
              await bot.sendPhoto(chatId, Buffer.from(imageBase64, 'base64'));
            } else {
              await bot.sendMessage(chatId, "(呜呜，这张照片触发了系统的安全拦截，没发出去🥺)");
            }
          } else {
            await bot.sendMessage(chatId, "(呜呜，这张照片触发了系统的安全拦截，没发出去🥺)");
          }
        }
      } catch (imgErr: any) {
        console.error("Image error:", imgErr);
        if (imgErr.message?.includes('PERMISSION_DENIED')) {
          await bot.sendMessage(chatId, "(呜呜，生成照片需要配置付费 API Key，请主人在控制台配置一下哦🥺)");
        } else {
          await bot.sendMessage(chatId, "(呜呜，照片没拍好，等下再给你看嘛🥺)");
        }
      }
    }

    if (videoPrompt) {
      bot.sendChatAction(chatId, 'record_video').catch(() => {});
      try {
        let operation = await fetchWithRetry(() => ai.models.generateVideos({
          model: config.videoModel,
          prompt: videoPrompt,
          config: { numberOfVideos: 1, aspectRatio: '9:16', resolution: '720p' }
        }));
        while (!operation.done) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          operation = await fetchWithRetry(() => ai.operations.getVideosOperation({operation: operation}));
        }
        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (downloadLink) {
          const response = await fetchWithRetry(() => fetch(downloadLink, {
            headers: { 'x-goog-api-key': apiKey }
          }));
          const arrayBuffer = await response.arrayBuffer();
          await bot.sendVideo(chatId, Buffer.from(arrayBuffer));
        }
      } catch (vidErr: any) {
        console.error("Video error:", vidErr);
        if (vidErr.message?.includes('PERMISSION_DENIED')) {
          await bot.sendMessage(chatId, "(呜呜，录视频需要配置付费 API Key，请主人在控制台配置一下哦🥺)");
        } else {
          await bot.sendMessage(chatId, "(呜呜，视频没录好，等下再给你看嘛🥺)");
        }
      }
    }

  } catch (err: any) {
    console.error("Bot logic error:", err);
    await bot.sendMessage(chatId, `呜呜，我脑子有点卡壳了，等我一下下哦🥺\n\n(Debug Error: ${err.message})`);
  }
};

if (bot) {
  bot.on('message', handleMessage);
}

// Export the express app for Vercel Serverless
export default app;

// Start server locally
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  import('vite').then(async ({ createServer: createViteServer }) => {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }).catch(err => console.error("Vite initialization failed:", err));
}
