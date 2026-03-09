import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { Redis as UpstashRedis } from '@upstash/redis';
import Redis from 'ioredis';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const PORT = 3000;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

let upstashClient: UpstashRedis | null = null;
let ioredisClient: Redis | null = null;

function getRedisClient() {
  if (upstashClient) return { type: 'upstash', client: upstashClient };
  if (ioredisClient) return { type: 'ioredis', client: ioredisClient };

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.REDIS_REST_API_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.REDIS_REST_API_TOKEN;
  
  if (upstashUrl && upstashToken) {
    try {
      upstashClient = new UpstashRedis({ url: upstashUrl, token: upstashToken });
      return { type: 'upstash', client: upstashClient };
    } catch (e) {
      console.error("Upstash Redis init error:", e);
    }
  }

  const redisUrl = process.env.REDIS_URL || process.env.KV_URL;
  if (redisUrl) {
    try {
      ioredisClient = new Redis(redisUrl);
      return { type: 'ioredis', client: ioredisClient };
    } catch (e) {
      console.error("ioredis init error:", e);
    }
  }

  return null;
}

// Fallback in-memory store if Redis is not configured
const memoryStore = new Map<string, any>();

async function getStore<T>(key: string, defaultValue: T): Promise<T> {
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.type === 'upstash') {
        const val = await (redis.client as UpstashRedis).get<T>(key);
        return val !== null ? val : defaultValue;
      } else {
        const valStr = await (redis.client as Redis).get(key);
        if (valStr) {
          try {
            return JSON.parse(valStr) as T;
          } catch (e) {
            return valStr as unknown as T;
          }
        }
        return defaultValue;
      }
    } catch (e) {
      console.error("Redis get error:", e);
      return defaultValue;
    }
  }
  return memoryStore.has(key) ? memoryStore.get(key) : defaultValue;
}

async function setStore(key: string, value: any): Promise<void> {
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.type === 'upstash') {
        await (redis.client as UpstashRedis).set(key, value);
      } else {
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        await (redis.client as Redis).set(key, valStr);
      }
    } catch (e) {
      console.error("Redis set error:", e);
    }
  } else {
    memoryStore.set(key, value);
  }
}

const DEFAULT_CONFIG = {
  textProvider: 'gemini',
  openRouterApiKey: '',
  openRouterModel: 'anthropic/claude-3-haiku',
  customTextEndpoint: 'https://api.venice.ai/api/v1/chat/completions',
  customTextApiKey: '',
  customTextModel: 'venice-uncensored',
  textModel: 'gemini-3-flash-preview',
  imageProvider: 'gemini',
  imageModel: 'gemini-2.5-flash-image',
  customImageEndpoint: 'https://api.venice.ai/api/v1/image/generate',
  customImageApiKey: '',
  customImageModel: 'fluently-xl',
  videoProvider: 'gemini',
  videoModel: 'veo-3.1-fast-generate-preview',
  enableVideo: false,
  customVideoEndpoint: '',
  customVideoApiKey: '',
  customVideoModel: '',
  enableVoice: false,
  voiceProvider: 'gemini',
  voiceModel: 'gemini-2.5-flash-preview-tts',
  voiceStyle: 'Kore',
  maxVoiceLength: 100,
  maxHistoryLength: 20,
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
  // Polling is disabled here to prevent the local/preview environment from 
  // stealing messages that should go to the Vercel webhook.
  /*
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    console.log("Starting Telegram Bot in Polling mode for local development...");
    bot.startPolling();
  }
  */
}

// API to get config
app.get('/api/config', async (req, res) => {
  const config = await getStore('bot_config', DEFAULT_CONFIG);
  res.json({ ...config, hasKv: !!getRedisClient() });
});

// Debug endpoint to check environment variables for Redis
app.get('/api/debug-env', (req, res) => {
  res.json({
    hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    hasKvUrl: !!process.env.KV_REST_API_URL,
    hasKvToken: !!process.env.KV_REST_API_TOKEN,
    hasRedisUrl: !!process.env.REDIS_URL,
    envKeys: Object.keys(process.env).filter(k => k.includes('REDIS') || k.includes('KV') || k.includes('UPSTASH'))
  });
});

// API to view current store data
app.get('/api/store', async (req, res) => {
  try {
    const redis = getRedisClient();
    if (redis) {
      const data: Record<string, any> = {};
      
      if (redis.type === 'upstash') {
        const keys = await (redis.client as UpstashRedis).keys('*');
        if (keys.length > 0) {
          for (const key of keys) {
            data[key] = await (redis.client as UpstashRedis).get(key);
          }
        }
      } else {
        const keys = await (redis.client as Redis).keys('*');
        if (keys.length > 0) {
          for (const key of keys) {
            const val = await (redis.client as Redis).get(key);
            try {
              data[key] = val ? JSON.parse(val) : null;
            } catch (e) {
              data[key] = val;
            }
          }
        }
      }
      
      res.json({
        type: redis.type === 'upstash' ? 'Upstash Redis (REST)' : 'Redis (Connection String)',
        data: data
      });
    } else {
      // Memory store is easy to dump
      const obj = Object.fromEntries(memoryStore);
      res.json({
        type: 'Memory Store',
        data: obj
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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

// Endpoint to easily set the Telegram webhook
app.get('/api/set-webhook', async (req, res) => {
  if (!bot) {
    return res.status(400).json({ error: "Bot not configured. Check TELEGRAM_BOT_TOKEN." });
  }
  try {
    // req.headers.host will be the Vercel domain (e.g., my-app.vercel.app)
    const webhookUrl = `https://${req.headers.host}/api/webhook`;
    await bot.setWebHook(webhookUrl, { drop_pending_updates: true } as any);
    res.json({ 
      success: true, 
      message: "Webhook set successfully!", 
      webhookUrl: webhookUrl 
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API to get Telegram file link and redirect (for viewing images in backend)
app.get('/api/file/:fileId', async (req, res) => {
  if (!bot) return res.status(400).send('Bot not configured');
  try {
    const fileLink = await bot.getFileLink(req.params.fileId);
    const response = await fetch(fileLink);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch from Telegram: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(500).send('Failed to get file: ' + err.message);
  }
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
    const update = req.body;
    
    // In serverless environments, we must await the handler before sending the response.
    // bot.processUpdate() triggers events but doesn't wait for async handlers to finish,
    // causing Vercel to kill the function prematurely (hence the "typing..." but no reply).
    if (update.message) {
      await handleMessage(update.message, req.headers.host);
    } else {
      // For other update types, just process normally (might get cut off, but less critical)
      bot.processUpdate(update);
    }
  } catch (e) {
    console.error("Error processing update:", e);
  }
  res.status(200).send('OK');
});

// Main logic handler
async function handleMessage(msg: TelegramBot.Message, host?: string) {
  if (!bot) return;
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  let userImageFileId = '';
  
  const baseUrl = host ? `https://${host}` : 'https://telegram-bot-nine-delta.vercel.app';

  if (msg.photo && msg.photo.length > 0) {
    userImageFileId = msg.photo[msg.photo.length - 1].file_id;
  }

  if (!text && !userImageFileId) return;

  if (text === '/clear') {
    await setStore(`history_${chatId}`, []);
    await bot.sendMessage(chatId, "记忆已清空，我们重新开始聊天吧！✨");
    return;
  }

  bot.sendChatAction(chatId, 'typing').catch(() => {});

  const config = await getStore('bot_config', DEFAULT_CONFIG);
  
  if (userImageFileId) {
    await setStore(`user_face_fileid_${chatId}`, userImageFileId);
    // Clear old base64 data to free up Redis space immediately
    await setStore(`user_face_${chatId}`, '');
  }

  let historyText = text;
  if (userImageFileId && !text) {
    historyText = `[男朋友发送了一张照片，并希望你以后发自拍时参考这张脸。]`;
  } else if (userImageFileId) {
    historyText = text + `\n[男朋友附带发送了一张照片，并希望你以后发自拍时参考这张脸。]`;
  }

  // If using Gemini, we can actually pass the image to the text model
  let geminiImagePart: any = null;
  if (config.textProvider === 'gemini' && userImageFileId) {
    try {
      const fileLink = await bot.getFileLink(userImageFileId);
      const response = await fetchWithRetry(() => fetch(fileLink));
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      geminiImagePart = { inlineData: { data: base64, mimeType: 'image/jpeg' } };
    } catch (err) {
      console.error("Failed to download face for gemini text model:", err);
    }
  }

  let history = await getStore<{role: string, parts: any[]}[]>(`history_${chatId}`, []);
  const maxLen = config.maxHistoryLength || 20;
  if (history.length > maxLen) history = history.slice(history.length - maxLen);
  
  const userParts: any[] = [{ text: historyText }];
  if (geminiImagePart) {
    userParts.push(geminiImagePart);
  }
  const newHistory = [...history, { role: 'user', parts: userParts }];

  try {
    const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
    // Remove accidental quotes and spaces
    const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
    
    if (!apiKey && config.textProvider === 'gemini') {
      throw new Error("未找到 Gemini API Key。请在 Vercel 的 Environment Variables 中配置 GEMINI_API_KEY。");
    }

    // Debug log to help identify key issues (only logs prefix and length, safe for production)
    console.log(`[Debug] Using API Key starting with: ${apiKey.substring(0, 4)}..., Length: ${apiKey.length}`);
    
    let activeSystemPrompt = config.systemPrompt;
    activeSystemPrompt += "\n\n[IMPORTANT: 如果你要发照片，必须严格使用 [PHOTO: 详细的英文描述] 格式，绝对不能用 [IMAGE: ...] 或中文描述！描述必须是纯英文！]";
    if (!config.enableVideo) {
      activeSystemPrompt += "\n[IMPORTANT: 视频生成功能当前已关闭。无论用户如何要求，绝对不要使用 [VIDEO: ...] 标记。如果用户要求看视频，请委婉地拒绝，比如撒娇说现在不方便录视频。]";
    }

    const ai = new GoogleGenAI({ apiKey });
    let botTextFull = '';

    if (config.textProvider === 'openrouter' || config.textProvider === 'custom') {
      const isCustom = config.textProvider === 'custom';
      const apiKey = isCustom ? config.customTextApiKey : config.openRouterApiKey;
      const model = isCustom ? config.customTextModel : config.openRouterModel;
      const endpoint = isCustom ? config.customTextEndpoint : "https://openrouter.ai/api/v1/chat/completions";

      if (!apiKey) throw new Error(`请先配置 ${isCustom ? 'Custom' : 'OpenRouter'} API Key`);
      
      // Normalize messages for strict providers like Anthropic
      const normalizedMessages: {role: string, content: string}[] = [];
      let lastRole = '';
      
      for (const m of newHistory) {
        const role = m.role === 'model' ? 'assistant' : 'user';
        // For non-Gemini providers, we only extract text parts.
        // We ignore image parts because most standard OpenAI-compatible APIs 
        // don't support the Gemini-specific inlineData format.
        const textParts = m.parts.filter((p: any) => p.text).map((p: any) => p.text);
        const content = textParts.join('\n');
        
        if (!content) continue;
        
        if (role === lastRole && normalizedMessages.length > 0) {
          normalizedMessages[normalizedMessages.length - 1].content += '\n' + content;
        } else {
          normalizedMessages.push({ role, content });
          lastRole = role;
        }
      }
      
      // Anthropic requires the first message to be 'user'
      if (normalizedMessages.length > 0 && normalizedMessages[0].role === 'assistant') {
        normalizedMessages.shift();
      }

      const orMessages: {role: string, content: string}[] = [];
      if (activeSystemPrompt) {
        orMessages.push({ role: "system", content: activeSystemPrompt });
      }
      orMessages.push(...normalizedMessages);
      
      const headers: any = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      };
      if (!isCustom) {
        headers["HTTP-Referer"] = baseUrl;
        headers["X-Title"] = "Telegram Bot";
      }

      const res = await fetchWithRetry(() => fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model,
          messages: orMessages,
          temperature: 0.7
        })
      }));
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const rawError = errData.error?.metadata?.raw || errData.error?.metadata || '';
        const rawErrorStr = typeof rawError === 'object' ? JSON.stringify(rawError) : rawError;
        throw new Error(`${isCustom ? 'Custom API' : 'OpenRouter'} Error: ${errData.error?.message || res.statusText}${rawErrorStr ? ` | Raw: ${rawErrorStr}` : ''}`);
      }
      const data = await res.json();
      botTextFull = data.choices?.[0]?.message?.content || '';
    } else {
      const response = await fetchWithRetry(() => ai.models.generateContent({
        model: config.textModel,
        contents: newHistory as any,
        config: {
          systemInstruction: activeSystemPrompt,
          temperature: 0.7,
        }
      }));
      botTextFull = response.text || '';
    }

    let botText = botTextFull;
    
    // Match [PHOTO: ...], [IMAGE: ...], [图片: ...], [照片: ...]
    const photoMatch = botTextFull.match(/\[(?:PHOTO|IMAGE|图片|照片)[:：]\s*([\s\S]*?)\]/i);
    let photoPrompt = '';
    if (photoMatch) {
      photoPrompt = photoMatch[1];
      botText = botText.replace(photoMatch[0], '').trim();
    }

    // Match [VIDEO: ...], [视频: ...]
    const videoMatch = botTextFull.match(/\[(?:VIDEO|视频)[:：]\s*([\s\S]*?)\]/i);
    let videoPrompt = '';
    if (videoMatch) {
      videoPrompt = videoMatch[1];
      botText = botText.replace(videoMatch[0], '').trim();
    }

    // Save history initially
    let currentHistory = [...newHistory, { role: 'model', parts: [{ text: botTextFull }] }];
    await setStore(`history_${chatId}`, currentHistory);

    if (botText) {
      await bot.sendMessage(chatId, botText);
    }

    if (config.enableVoice && botText) {
      try {
        let textToRead = botText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ''); // Remove emojis for better TTS
        if (config.maxVoiceLength && textToRead.length > config.maxVoiceLength) {
          textToRead = textToRead.substring(0, config.maxVoiceLength);
        }

        if (textToRead.trim().length > 0) {
          bot.sendChatAction(chatId, 'record_voice').catch(() => {});
          let audioBase64 = '';

          if (config.voiceProvider === 'openrouter') {
            const apiKey = config.openRouterApiKey;
            if (!apiKey) throw new Error("OpenRouter API Key not configured");

            const res = await fetchWithRetry(() => fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: config.voiceModel || "openai/gpt-4o-mini-audio-preview",
                messages: [
                  { role: "system", content: "You are a text-to-speech engine. Please read the following text exactly as provided, with a sweet and natural tone." },
                  { role: "user", content: textToRead }
                ],
                modalities: ["text", "audio"],
                audio: {
                  voice: config.voiceStyle || "shimmer",
                  format: "wav"
                }
              })
            }));

            if (!res.ok) {
              const err = await res.json().catch(()=>({}));
              throw new Error(`OpenRouter Voice Error: ${JSON.stringify(err)}`);
            }

            const data = await res.json();
            audioBase64 = data.choices?.[0]?.message?.audio?.data || '';
          } else {
            // Gemini TTS
            const response = await fetchWithRetry(() => ai.models.generateContent({
              model: config.voiceModel || "gemini-2.5-flash-preview-tts",
              contents: [{ parts: [{ text: textToRead }] }],
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: config.voiceStyle || "Kore" }
                  }
                }
              }
            }));
            audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || '';
          }

          if (audioBase64) {
            await bot.sendVoice(chatId, Buffer.from(audioBase64, 'base64'));
          }
        }
      } catch (err: any) {
        console.error("Voice error:", err);
      }
    }

    if (photoPrompt) {
      bot.sendChatAction(chatId, 'upload_photo').catch(() => {});
      try {
        let faceBase64 = await getStore<string>(`user_face_${chatId}`, '');
        const faceFileId = await getStore<string>(`user_face_fileid_${chatId}`, '');
        
        if (faceFileId) {
          try {
            const fileLink = await bot.getFileLink(faceFileId);
            const response = await fetchWithRetry(() => fetch(fileLink));
            const arrayBuffer = await response.arrayBuffer();
            faceBase64 = Buffer.from(arrayBuffer).toString('base64');
          } catch (err) {
            console.error("Failed to download face from telegram:", err);
          }
        }

        const imageParts: any[] = [];
        
        if (faceBase64) {
          imageParts.push({ inlineData: { data: faceBase64, mimeType: 'image/jpeg' } });
          imageParts.push({ text: `A photo of this exact person: ${photoPrompt}. Strictly maintain the facial features and identity of the person in the reference image.` });
        } else {
          imageParts.push({ text: photoPrompt });
        }

        if (config.imageProvider === 'custom') {
          if (!config.customImageApiKey || !config.customImageEndpoint) {
            throw new Error("Custom Image API not configured");
          }
          const res = await fetchWithRetry(() => fetch(config.customImageEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.customImageApiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: config.customImageModel,
              prompt: photoPrompt,
              return_binary: false,
              safe_mode: false
            })
          }));
          
          if (!res.ok) {
            const errData = await res.json().catch(()=>({}));
            throw new Error(`Custom Image API Error: ${JSON.stringify(errData)}`);
          }
          
          const data = await res.json();
          let imageBase64 = data.data?.[0]?.b64_json || data.images?.[0] || '';
          let imageUrl = data.data?.[0]?.url || data.url || '';
          
          if (imageBase64) {
            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
            await bot.sendPhoto(chatId, Buffer.from(base64Data, 'base64'));
          } else if (imageUrl) {
            const imgRes = await fetchWithRetry(() => fetch(imageUrl));
            const imgBuf = await imgRes.arrayBuffer();
            await bot.sendPhoto(chatId, Buffer.from(imgBuf));
          } else {
            throw new Error("No image returned from custom API");
          }
        } else {
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
            const sentMsg = await bot.sendPhoto(chatId, Buffer.from(imageBase64, 'base64'));
            if (sentMsg.photo && sentMsg.photo.length > 0) {
              // Photo sent successfully, no need to append system record to history
              // as it causes the model to hallucinate system records in future turns.
            }
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
                const sentMsg = await bot.sendPhoto(chatId, Buffer.from(imageBase64, 'base64'));
                if (sentMsg.photo && sentMsg.photo.length > 0) {
                  // Photo sent successfully
                }
              } else {
                await bot.sendMessage(chatId, "(呜呜，这张照片触发了系统的安全拦截，没发出去🥺)");
              }
            } else {
              await bot.sendMessage(chatId, "(呜呜，这张照片触发了系统的安全拦截，没发出去🥺)");
            }
          }
        }
      } catch (imgErr: any) {
        console.error("Image error:", imgErr);
        if (imgErr.message?.includes('PERMISSION_DENIED')) {
          await bot.sendMessage(chatId, "(呜呜，生成照片需要配置付费 API Key，请主人在控制台配置一下哦🥺)");
        } else {
          await bot.sendMessage(chatId, `(呜呜，照片没拍好，等下再给你看嘛🥺 错误详情: ${imgErr.message})`);
        }
      }
    }

    if (videoPrompt) {
      if (!config.enableVideo) {
        // Just in case the model still outputs the tag, we ignore it and let the user know
        await bot.sendMessage(chatId, "(视频功能已关闭，脑补一下吧~)");
      } else {
        bot.sendChatAction(chatId, 'record_video').catch(() => {});
        try {
          if (config.videoProvider === 'custom') {
            if (!config.customVideoApiKey || !config.customVideoEndpoint) {
              throw new Error("Custom Video API not configured");
            }
            const res = await fetchWithRetry(() => fetch(config.customVideoEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${config.customVideoApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: config.customVideoModel,
                prompt: videoPrompt
              })
            }));
            
            if (!res.ok) {
              const errData = await res.json().catch(()=>({}));
              throw new Error(`Custom Video API Error: ${JSON.stringify(errData)}`);
            }
            
            const data = await res.json();
            let vidUrl = data.data?.[0]?.url || data.video_url || data.url || '';
            
            if (vidUrl) {
              const vidRes = await fetchWithRetry(() => fetch(vidUrl));
              const vidBuf = await vidRes.arrayBuffer();
              const sentMsg = await bot.sendVideo(chatId, Buffer.from(vidBuf));
              if (sentMsg.video) {
                // Video sent successfully
              }
            } else {
              throw new Error("No video returned from custom API");
            }
          } else {
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
              const sentMsg = await bot.sendVideo(chatId, Buffer.from(arrayBuffer));
              if (sentMsg.video) {
                // Video sent successfully
              }
            }
          }
        } catch (vidErr: any) {
          console.error("Video error:", vidErr);
          if (vidErr.message?.includes('PERMISSION_DENIED')) {
            await bot.sendMessage(chatId, "(呜呜，录视频需要配置付费 API Key，请主人在控制台配置一下哦🥺)");
          } else {
            await bot.sendMessage(chatId, `(呜呜，视频没录好，等下再给你看嘛🥺 错误详情: ${vidErr.message})`);
          }
        }
      }
    }

  } catch (err: any) {
    console.error("Bot logic error:", err);
    const isVercel = !!process.env.VERCEL;
    
    let keyPrefix = 'none';
    let keyLen = 0;
    let providerName = 'Unknown';
    
    try {
      const config = await getStore('bot_config', DEFAULT_CONFIG);
      if (config.textProvider === 'openrouter') {
        providerName = 'OpenRouter';
        const orKey = config.openRouterApiKey || '';
        keyPrefix = orKey ? orKey.substring(0, 4) : 'none';
        keyLen = orKey ? orKey.length : 0;
      } else {
        providerName = 'Gemini';
        const rawApiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        const apiKey = rawApiKey.replace(/^["']|["']$/g, '').trim();
        keyPrefix = apiKey ? apiKey.substring(0, 4) : 'none';
        keyLen = apiKey ? apiKey.length : 0;
      }
    } catch (e) {
      // Fallback if config fetch fails
    }
    
    await bot.sendMessage(chatId, `呜呜，我脑子有点卡壳了，等我一下下哦🥺\n\n[Env: ${isVercel ? 'Vercel' : 'Local'}, Provider: ${providerName}, Key: ${keyPrefix}...(${keyLen})]\n(Debug Error: ${err.message})`);
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
