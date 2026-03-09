import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle, AlertCircle, Settings, Key, Save, Database, MessageSquare, Image as ImageIcon, Code, RefreshCw } from 'lucide-react';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [status, setStatus] = useState<'loading' | 'active' | 'inactive'>('loading');
  const [hasPaidKey, setHasPaidKey] = useState(false);
  const [hasKv, setHasKv] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<'config' | 'store'>('config');
  const [storeData, setStoreData] = useState<any>(null);
  const [loadingStore, setLoadingStore] = useState(false);
  
  // Models and Prompt State
  const [textProvider, setTextProvider] = useState<'gemini' | 'openrouter' | 'custom'>('gemini');
  const [openRouterApiKey, setOpenRouterApiKey] = useState('');
  const [openRouterModel, setOpenRouterModel] = useState('anthropic/claude-3-haiku');
  const [customTextEndpoint, setCustomTextEndpoint] = useState('https://api.venice.ai/api/v1/chat/completions');
  const [customTextApiKey, setCustomTextApiKey] = useState('');
  const [customTextModel, setCustomTextModel] = useState('venice-uncensored');
  const [textModel, setTextModel] = useState('gemini-3-flash-preview');
  
  const [imageProvider, setImageProvider] = useState<'gemini' | 'custom'>('gemini');
  const [imageModel, setImageModel] = useState('gemini-2.5-flash-image');
  const [customImageEndpoint, setCustomImageEndpoint] = useState('https://api.venice.ai/api/v1/image/generate');
  const [customImageApiKey, setCustomImageApiKey] = useState('');
  const [customImageModel, setCustomImageModel] = useState('fluently-xl');

  const [videoProvider, setVideoProvider] = useState<'gemini' | 'custom'>('gemini');
  const [videoModel, setVideoModel] = useState('veo-3.1-fast-generate-preview');
  const [customVideoEndpoint, setCustomVideoEndpoint] = useState('');
  const [customVideoApiKey, setCustomVideoApiKey] = useState('');
  const [customVideoModel, setCustomVideoModel] = useState('');
  
  const [enableVideo, setEnableVideo] = useState(false);
  const [maxHistoryLength, setMaxHistoryLength] = useState(20);
  const [systemPrompt, setSystemPrompt] = useState('');

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasPaidKey(hasKey);
      }
    };
    checkKey();

    fetch('/api/health')
      .then(res => res.json())
      .then(data => {
        setStatus(data.botActive ? 'active' : 'inactive');
      })
      .catch(() => setStatus('inactive'));

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setTextProvider(data.textProvider);
        setOpenRouterApiKey(data.openRouterApiKey);
        setOpenRouterModel(data.openRouterModel);
        setCustomTextEndpoint(data.customTextEndpoint || 'https://api.venice.ai/api/v1/chat/completions');
        setCustomTextApiKey(data.customTextApiKey || '');
        setCustomTextModel(data.customTextModel || 'venice-uncensored');
        setTextModel(data.textModel);
        setImageProvider(data.imageProvider || 'gemini');
        setImageModel(data.imageModel);
        setCustomImageEndpoint(data.customImageEndpoint || 'https://api.venice.ai/api/v1/image/generate');
        setCustomImageApiKey(data.customImageApiKey || '');
        setCustomImageModel(data.customImageModel || 'fluently-xl');
        
        setVideoProvider(data.videoProvider || 'gemini');
        setVideoModel(data.videoModel);
        setCustomVideoEndpoint(data.customVideoEndpoint || '');
        setCustomVideoApiKey(data.customVideoApiKey || '');
        setCustomVideoModel(data.customVideoModel || '');
        
        setEnableVideo(data.enableVideo ?? false);
        setMaxHistoryLength(data.maxHistoryLength ?? 20);
        setSystemPrompt(data.systemPrompt);
        setHasKv(data.hasKv);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textProvider,
          openRouterApiKey,
          openRouterModel,
          customTextEndpoint,
          customTextApiKey,
          customTextModel,
          textModel,
          imageProvider,
          imageModel,
          customImageEndpoint,
          customImageApiKey,
          customImageModel,
          videoProvider,
          videoModel,
          customVideoEndpoint,
          customVideoApiKey,
          customVideoModel,
          enableVideo,
          maxHistoryLength,
          systemPrompt
        })
      });
      alert('配置保存成功！');
    } catch (e) {
      alert('保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      try {
        await window.aistudio.openSelectKey();
        setHasPaidKey(true);
      } catch (e) {
        console.error("Failed to open key selector:", e);
      }
    }
  };

  const fetchStoreData = async () => {
    setLoadingStore(true);
    try {
      const res = await fetch('/api/store');
      const data = await res.json();
      setStoreData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStore(false);
    }
  };

  const renderStoreView = () => {
    if (loadingStore) {
      return <div className="p-12 text-center text-gray-500 flex flex-col items-center"><RefreshCw className="w-8 h-8 animate-spin mb-4 text-blue-500" />加载数据中...</div>;
    }
    if (!storeData) {
      return <div className="p-12 text-center text-gray-500">暂无数据</div>;
    }

    const data = storeData.data || {};
    const keys = Object.keys(data);
    
    const historyKeys = keys.filter(k => k.startsWith('history_'));
    const faceKeys = keys.filter(k => k.startsWith('user_face_'));
    const otherKeys = keys.filter(k => !k.startsWith('history_') && !k.startsWith('user_face_'));

    const renderTextWithLinks = (text: string) => {
      if (!text) return null;
      const urlRegex = /(https?:\/\/[^\s\]]+)/g;
      const parts = text.split(urlRegex);
      return parts.map((part, i) => {
        if (part.match(urlRegex)) {
          return (
            <a 
              key={i} 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="underline font-medium hover:opacity-80"
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      });
    };

    return (
      <div className="space-y-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg text-sm font-medium">
            <Database className="w-4 h-4" />
            当前存储类型: {storeData.type}
          </div>
          <button onClick={fetchStoreData} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 bg-gray-100 px-3 py-1.5 rounded-lg transition-colors">
            <RefreshCw className="w-4 h-4" /> 刷新数据
          </button>
        </div>

        {/* Chat Histories */}
        {historyKeys.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2 border-b border-gray-100 pb-2">
              <MessageSquare className="w-5 h-5 text-blue-500" /> 聊天记录
            </h3>
            {historyKeys.map(key => {
              const chatId = key.replace('history_', '');
              const history = data[key] || [];
              return (
                <div key={key} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <div className="text-xs text-gray-500 mb-3 font-mono">Chat ID: {chatId}</div>
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-2">
                    {history.map((msg: any, i: number) => (
                      <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                          msg.role === 'user' 
                            ? 'bg-blue-500 text-white rounded-tr-sm' 
                            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                        }`}>
                          {msg.parts?.[0]?.text ? renderTextWithLinks(msg.parts[0].text) : '[多媒体消息]'}
                        </div>
                      </div>
                    ))}
                    {history.length === 0 && <div className="text-sm text-gray-400 text-center">暂无聊天记录</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Saved Faces */}
        {faceKeys.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2 border-b border-gray-100 pb-2">
              <ImageIcon className="w-5 h-5 text-pink-500" /> 记住的脸
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {faceKeys.map(key => {
                const chatId = key.replace('user_face_', '');
                return (
                  <div key={key} className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm flex flex-col items-center">
                    <img src={`data:image/jpeg;base64,${data[key]}`} alt="User Face" className="w-24 h-24 object-cover rounded-full mb-2 border-2 border-pink-100" referrerPolicy="no-referrer" />
                    <div className="text-xs text-gray-500 font-mono text-center truncate w-full">ID: {chatId}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Other Configs */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2 border-b border-gray-100 pb-2">
            <Code className="w-5 h-5 text-gray-500" /> 其他配置数据
          </h3>
          {otherKeys.map(key => (
            <div key={key} className="bg-gray-900 rounded-xl p-4 overflow-x-auto">
              <div className="text-xs text-gray-400 mb-2 font-mono">{key}</div>
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {JSON.stringify(data[key], null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 font-sans">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-[#2AABEE] p-8 text-white text-center">
          <Bot className="w-16 h-16 mx-auto mb-4 opacity-90" />
          <h1 className="text-3xl font-bold mb-2">俏皮女友 Telegram Bot</h1>
          <p className="text-blue-100">Vercel Serverless 就绪版控制台</p>
        </div>
        
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button 
            onClick={() => setActiveTab('config')} 
            className={`flex-1 py-4 font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'config' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Settings className="w-4 h-4" /> 机器人配置
          </button>
          <button 
            onClick={() => { setActiveTab('store'); fetchStoreData(); }} 
            className={`flex-1 py-4 font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'store' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:bg-gray-100'}`}
          >
            <Database className="w-4 h-4" /> 后台数据
          </button>
        </div>
        
        <div className="p-8">
          {activeTab === 'config' ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="flex flex-col p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="font-medium text-gray-700 mb-2">Bot 后端状态</div>
                  {status === 'loading' && <span className="text-gray-400">检查中...</span>}
                  {status === 'active' && (
                    <div className="flex items-center gap-2 text-green-600 font-medium">
                      <CheckCircle className="w-5 h-5" />
                      运行中
                    </div>
                  )}
                  {status === 'inactive' && (
                    <div className="flex items-center gap-2 text-red-600 font-medium">
                      <AlertCircle className="w-5 h-5" />
                      未启动 (缺少 Token)
                    </div>
                  )}
                </div>

                <div className="flex flex-col p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="font-medium text-gray-700 mb-2">持久化存储状态</div>
                  {hasKv ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-green-600 font-medium">
                        <CheckCircle className="w-5 h-5" />
                        Upstash Redis 已连接
                      </div>
                      <button onClick={() => { setActiveTab('store'); fetchStoreData(); }} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                        <Database className="w-4 h-4" /> 查看数据
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-amber-600 font-medium">
                          <AlertCircle className="w-5 h-5" />
                          使用内存 (重启会丢失)
                        </div>
                        <button onClick={() => { setActiveTab('store'); fetchStoreData(); }} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                          <Database className="w-4 h-4" /> 查看数据
                        </button>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        提示: 如果你在 Vercel 创建了 Redis 数据库但这里仍显示内存，请确保在 Vercel 后台点击了 <strong>Redeploy</strong> (重新部署)，以使 UPSTASH_REDIS_REST_URL 环境变量生效。
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-800">模型与人设配置</h2>
              </div>
              
              {!hasPaidKey ? (
                <button 
                  onClick={handleSelectKey}
                  className="flex items-center gap-2 bg-amber-100 text-amber-700 hover:bg-amber-200 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Key className="w-4 h-4" />
                  配置付费 API Key (用于视频生成)
                </button>
              ) : (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-3 py-1.5 rounded-lg text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  已配置付费 API Key
                </div>
              )}
            </div>
            
            {/* Text Model Settings */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-md font-medium text-gray-800 mb-3">文字聊天模型</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">提供商</label>
                  <select value={textProvider} onChange={e => setTextProvider(e.target.value as any)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                    <option value="gemini">Google Gemini (内置)</option>
                    <option value="openrouter">OpenRouter (第三方)</option>
                    <option value="custom">自定义 API (如 Venice AI)</option>
                  </select>
                </div>
                
                {textProvider === 'gemini' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">模型选择</label>
                    <select value={textModel} onChange={e => setTextModel(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                      <option value="gemini-3-flash-preview">Gemini 3 Flash (推荐)</option>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (更聪明)</option>
                      <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (更快)</option>
                    </select>
                  </div>
                ) : textProvider === 'openrouter' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">OpenRouter 模型名称</label>
                      <input type="text" value={openRouterModel} onChange={e => setOpenRouterModel(e.target.value)} placeholder="例如: anthropic/claude-3-haiku" className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">OpenRouter API Key</label>
                      <input type="password" value={openRouterApiKey} onChange={e => setOpenRouterApiKey(e.target.value)} placeholder="sk-or-v1-..." className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 gap-3 bg-white p-3 rounded border border-gray-200 md:col-span-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">API Endpoint URL</label>
                      <input type="text" value={customTextEndpoint} onChange={e => setCustomTextEndpoint(e.target.value)} placeholder="https://api.venice.ai/api/v1/chat/completions" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                      <input type="password" value={customTextApiKey} onChange={e => setCustomTextApiKey(e.target.value)} placeholder="Bearer Token" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">模型名称</label>
                      <input type="text" value={customTextModel} onChange={e => setCustomTextModel(e.target.value)} placeholder="venice-uncensored" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Media Model Settings */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-md font-medium text-gray-800">多媒体生成模型</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm text-gray-600 font-medium">允许生成视频</span>
                  <div className="relative inline-block w-10 mr-2 align-middle select-none transition duration-200 ease-in">
                    <input type="checkbox" checked={enableVideo} onChange={e => setEnableVideo(e.target.checked)} className="toggle-checkbox absolute block w-5 h-5 rounded-full bg-white border-4 appearance-none cursor-pointer transition-transform duration-200 ease-in-out" style={{ transform: enableVideo ? 'translateX(100%)' : 'translateX(0)', borderColor: enableVideo ? '#3B82F6' : '#D1D5DB' }}/>
                    <div className={`toggle-label block overflow-hidden h-5 rounded-full cursor-pointer transition-colors duration-200 ease-in-out ${enableVideo ? 'bg-blue-500' : 'bg-gray-300'}`}></div>
                  </div>
                </label>
              </div>

              {/* Image Settings */}
              <div className="mb-4 border-b border-gray-200 pb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">图片生成提供商</label>
                <select value={imageProvider} onChange={e => setImageProvider(e.target.value as any)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-3">
                  <option value="gemini">Google Gemini (内置, 支持参考人脸)</option>
                  <option value="custom">自定义 API (如 Venice AI)</option>
                </select>

                {imageProvider === 'gemini' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">图片模型</label>
                    <select value={imageModel} onChange={e => setImageModel(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                      <option value="gemini-2.5-flash-image">Gemini 2.5 Flash Image (推荐)</option>
                      <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash Image (高质量)</option>
                    </select>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 bg-white p-3 rounded border border-gray-200">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">API Endpoint URL</label>
                      <input type="text" value={customImageEndpoint} onChange={e => setCustomImageEndpoint(e.target.value)} placeholder="https://api.venice.ai/api/v1/image/generate" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                      <input type="password" value={customImageApiKey} onChange={e => setCustomImageApiKey(e.target.value)} placeholder="Bearer Token" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">模型名称</label>
                      <input type="text" value={customImageModel} onChange={e => setCustomImageModel(e.target.value)} placeholder="fluently-xl" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                )}
              </div>

              {/* Video Settings */}
              {enableVideo && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">视频生成提供商</label>
                  <select value={videoProvider} onChange={e => setVideoProvider(e.target.value as any)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none mb-3">
                    <option value="gemini">Google Veo (内置)</option>
                    <option value="custom">自定义 API</option>
                  </select>

                  {videoProvider === 'gemini' ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">视频模型</label>
                      <select value={videoModel} onChange={e => setVideoModel(e.target.value)} className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                        <option value="veo-3.1-fast-generate-preview">Veo 3.1 Fast (推荐)</option>
                        <option value="veo-3.1-generate-preview">Veo 3.1 (高质量)</option>
                      </select>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 bg-white p-3 rounded border border-gray-200">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">API Endpoint URL</label>
                        <input type="text" value={customVideoEndpoint} onChange={e => setCustomVideoEndpoint(e.target.value)} placeholder="https://api.example.com/v1/video/generate" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                        <input type="password" value={customVideoApiKey} onChange={e => setCustomVideoApiKey(e.target.value)} placeholder="Bearer Token" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">模型名称</label>
                        <input type="text" value={customVideoModel} onChange={e => setCustomVideoModel(e.target.value)} placeholder="video-model-name" className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Context Settings */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-md font-medium text-gray-800 mb-3">上下文记忆配置</h3>
              <div>
                <label className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                  <span>保留历史消息条数 (1个回合 = 1条User + 1条AI)</span>
                  <span className="text-blue-600 font-bold">{maxHistoryLength} 条</span>
                </label>
                <input 
                  type="range" 
                  min="2" 
                  max="100" 
                  step="2"
                  value={maxHistoryLength} 
                  onChange={e => setMaxHistoryLength(parseInt(e.target.value))} 
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <p className="text-xs text-gray-500 mt-2">
                  提示：条数越多，机器人记得越久，但消耗的 Token 也越多。建议保持在 20-40 条左右。
                </p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">系统提示词 (Prompt)</label>
              <textarea 
                value={systemPrompt} 
                onChange={e => setSystemPrompt(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm h-48 font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            <button 
              onClick={handleSave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              <Save className="w-5 h-5" />
              {saving ? '保存中...' : '保存配置到后端'}
            </button>
          </div>

          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm leading-relaxed">
            <strong>🎉 架构已升级：</strong><br/>
            现在 AI 大脑已经完全迁移到后端！你<strong>不再需要保持这个页面打开</strong>，Bot 也能随时回复你。配置保存在后端，支持 Upstash Redis 持久化存储。
          </div>
          </>
          ) : (
            renderStoreView()
          )}
        </div>
      </div>
    </div>
  );
}
