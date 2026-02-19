// ProviderManager — black-box AI provider abstraction
// Owns chains, credentials, token refresh, usage tracking.
// The rest of the app just calls callAI({ tier }) and gets a response.

import { buildProviderChain, SESSION_TIER_MAP, getAllProviders, PROVIDERS } from './providers.js';
import { callWithFallback, ensureFreshToken } from './provider.js';
import { calculateCost } from './usage.js';
import { getSetting, getConnection, updateAccessToken, storeUsage } from './db.js';

export async function createProviderManager(db) {
  const chains = {};          // { basic: [...], standard: [...], reasoning: [...] }
  let allConnections = [];    // cached connections from init
  let allProviders = PROVIDERS;
  let _callFn = callWithFallback;  // swappable for tests

  function notifyStatusBar() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('statusbar-refresh'));
  }

  function notifyProvider() {
    if (typeof window === 'undefined') return;
    const chain = chains.standard || chains.basic || chains.reasoning;
    if (!chain?.length) return;
    const primary = chain[0];
    const catalog = allProviders[primary.providerId];
    window.dispatchEvent(new CustomEvent('provider-update', {
      detail: {
        id: primary.providerId,
        name: catalog?.name || primary.providerId,
        icon: catalog?.icon || '',
        model: primary.model,
      },
    }));
  }

  const manager = {
    async init() {
      // Read enabled providers + connections (one DB pass)
      const enabledJson = await getSetting(db, 'ai_providers_enabled');
      const enabledIds = enabledJson ? JSON.parse(enabledJson) : ['thinkdone'];
      const customJson = await getSetting(db, 'custom_providers');
      allProviders = getAllProviders(customJson);

      allConnections = [];
      for (const id of Object.keys(allProviders)) {
        const conn = await getConnection(db, id);
        if (conn) {
          allConnections.push(conn);
          if (!enabledIds.includes(id)) enabledIds.push(id);
        }
      }

      // Build chains for all 3 tiers
      for (const tier of ['basic', 'standard', 'reasoning']) {
        const chain = buildProviderChain(enabledIds, allConnections, tier, allProviders);
        chain._tier = tier;
        chains[tier] = chain;
      }

      notifyProvider();
    },

    async callAI({ system, messages, tier = 'standard' }) {
      const chain = chains[tier] || chains.standard;
      if (!chain?.length) throw new Error(`No providers available for tier: ${tier}`);
      const result = await _callFn(chain, { system, messages });

      // Auto-persist refreshed tokens
      const conn = result.provider?.connection;
      if (conn?._refreshed) {
        await updateAccessToken(db, conn.provider, conn.access_token, conn.expires_at);
        conn._refreshed = false;
      }

      return result;
    },

    async trackUsage(result, sessionType = 'chat') {
      if (!result.usage || !db) return;
      const u = result.usage;
      const cost = calculateCost(u.model, u.input_tokens, u.output_tokens, {
        cacheReadTokens: u.cache_read_input_tokens || 0,
        cacheWriteTokens: u.cache_creation_input_tokens || 0,
      });
      await storeUsage(db, {
        sessionType,
        model: u.model,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        costUsd: cost,
        provider: result.usedProvider?.providerId || 'thinkdone',
        cacheReadTokens: u.cache_read_input_tokens || 0,
        cacheWriteTokens: u.cache_creation_input_tokens || 0,
      });
      notifyStatusBar();
    },

    getExtractionCredentials() {
      // Scan chains for Gemini credentials only (extraction calls Gemini API directly)
      let apiKey, accessToken;
      for (const tier of ['basic', 'standard', 'reasoning']) {
        for (const entry of (chains[tier] || [])) {
          if (entry.providerId !== 'gemini') continue;
          const c = entry.connection;
          if (!c?.access_token) continue;
          if (c.refresh_token) { accessToken = c.access_token; }
          else { apiKey = c.access_token; }
          return { apiKey, accessToken };
        }
      }
      return { apiKey, accessToken };
    },

    async getSpeechCredentials(connKey) {
      const conn = await getConnection(db, connKey);
      if (!conn?.access_token) return null;
      const isOAuth = !!conn.refresh_token;
      let apiKey = conn.access_token;
      if (isOAuth) {
        try {
          apiKey = await ensureFreshToken(conn);
          if (conn._refreshed) await updateAccessToken(db, connKey, conn.access_token, conn.expires_at);
        } catch (e) {
          console.error('[ProviderManager] token refresh failed:', e);
        }
      }
      return { apiKey, isOAuth };
    },

    extractionOpts(extra = {}) {
      const creds = manager.getExtractionCredentials();
      return { ...creds, ...extra };
    },

    get primary() {
      const chain = chains.standard || chains.basic || chains.reasoning;
      if (!chain?.length) return null;
      const p = chain[0];
      const catalog = allProviders[p.providerId];
      return {
        id: p.providerId,
        name: catalog?.name || p.providerId,
        icon: catalog?.icon || '',
        model: p.model,
      };
    },

    // Test hook: override the call function
    _setCallFn(fn) { _callFn = fn; },
  };

  return manager;
}
