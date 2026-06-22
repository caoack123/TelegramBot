import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) return null;

  supabaseClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabaseClient;
}

export async function getPersistentState<T>(key: string): Promise<T | undefined> {
  const client = getSupabaseClient();
  if (!client) return undefined;

  const { data, error } = await client
    .from('app_state')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data?.value as T | undefined;
}

export async function setPersistentState(key: string, value: unknown): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured');

  const { error } = await client
    .from('app_state')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function listPersistentState(): Promise<Record<string, unknown> | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from('app_state')
    .select('key,value')
    .order('key');
  if (error) throw error;
  const state = Object.fromEntries((data || []).map((row) => [row.key, row.value]));
  const { data: messages, error: messagesError } = await client
    .from('chat_messages')
    .select('chat_id,role,parts,id')
    .order('id');
  if (messagesError) throw messagesError;
  for (const message of messages || []) {
    const key = `history_${message.chat_id}`;
    const history = (state[key] ||= []) as unknown[];
    history.push({ role: message.role, parts: message.parts });
  }
  return state;
}

export type ChatMessage = { role: 'user' | 'model'; parts: Array<{ text: string }> };

export async function getChatHistory(chatId: number, limit: number): Promise<ChatMessage[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  const { data, error } = await client
    .from('chat_messages')
    .select('role,parts,id')
    .eq('chat_id', chatId)
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse().map(({ role, parts }) => ({ role, parts })) as ChatMessage[];
}

export async function appendChatTurn(chatId: number, userText: string, modelText: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured');
  const { error } = await client.from('chat_messages').insert([
    { chat_id: chatId, role: 'user', parts: [{ text: userText }] },
    { chat_id: chatId, role: 'model', parts: [{ text: modelText }] },
  ]);
  if (error) throw error;
}

export async function clearChatHistory(chatId: number): Promise<void> {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured');
  const { error } = await client.from('chat_messages').delete().eq('chat_id', chatId);
  if (error) throw error;
}

export async function claimPersistentUpdate(updateId: number): Promise<boolean | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { error } = await client
    .from('processed_updates')
    .insert({ update_id: updateId });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw error;
}

export async function isPersistentStorageAvailable(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  const { error } = await client.from('app_state').select('key').limit(1);
  return !error;
}
