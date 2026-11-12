import * as SecureStore from 'expo-secure-store';

// Small on-device flags (for example "the person dismissed a tip"). Nothing sensitive, so a failure just means the tip shows again.
const key = (name: string) => `waypoint.flag.${name}`.replace(/[^A-Za-z0-9._-]/g, '_');
export async function getFlag(name: string): Promise<string | null> { try { return await SecureStore.getItemAsync(key(name)); } catch { return null; } }
export async function setFlag(name: string, value: string): Promise<void> { try { await SecureStore.setItemAsync(key(name), value); } catch { /* ignore */ } }
