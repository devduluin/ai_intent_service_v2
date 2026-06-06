import type { PipelineInput, PipelineResult } from '../types';
import { globalCache } from '../utils/cache-helper.util';
import { automationModeService } from './automation-mode.service';
import { userProfileModeService } from './user-profile-mode.service';
import { broadcastModeChange as broadcastModeChangeUtil } from '../utils/websocket-broadcast.util';
import { appLogger } from '../utils/logger.util';
import { chatWsService, WS_MESSAGE_TYPE } from './chat-ws.service';

const TTL_MS = 5 * 60 * 1000;

export type GodModeName =
  | 'automation_manager'
  | 'user_profile';

export interface GodModeState {
  active: true;
  mode: GodModeName;
  enteredAt: number;
}

interface GodModeHandler {
  mode: GodModeName;
  isEnterIntent(text: string): boolean;
  isExitIntent(text: string): boolean;
  isActive(userId: string, appName: string): Promise<boolean>;
  handle(input: PipelineInput, startTotal: number): Promise<PipelineResult>;
  exit(userId: string, appName: string): Promise<void>;
}

class GodModeManagerService {
  private handlers: GodModeHandler[] = [
    {
      mode: 'automation_manager',
      isEnterIntent: text => automationModeService.isEnterIntent(text),
      isExitIntent: text => automationModeService.isExitIntent(text),
      isActive: async (userId, appName) => !!await automationModeService.get(userId, appName),
      handle: (input, startTotal) => automationModeService.handle(input, startTotal),
      exit: (userId, appName) => automationModeService.exit(userId, appName)
    },
    {
      mode: 'user_profile',
      isEnterIntent: text => userProfileModeService.isEnterIntent(text),
      isExitIntent: text => userProfileModeService.isExitIntent(text),
      isActive: async (userId, appName) => !!await userProfileModeService.get(userId, appName),
      handle: (input, startTotal) => userProfileModeService.handle(input, startTotal),
      exit: (userId, appName) => userProfileModeService.exit(userId, appName)
    }
  ];

  async get(userId: string, appName: string): Promise<GodModeState | null> {
    const stored = await globalCache.get<GodModeState>(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
    if (stored) {
      await this.set(userId, appName, stored.mode, stored.enteredAt);
      return stored;
    }

    const activeHandler = await this.findActiveHandler(userId, appName);
    if (!activeHandler) return null;

    const state: GodModeState = {
      active: true,
      mode: activeHandler.mode,
      enteredAt: Date.now()
    };
    await this.set(userId, appName, activeHandler.mode, state.enteredAt);
    return state;
  }

  async shouldHandle(input: PipelineInput): Promise<boolean> {
    return !!await this.get(input.user_id, input.app_name) ||
      this.handlers.some(handler => handler.isEnterIntent(input.text));
  }

  isEnterCommand(text: string): boolean {
    return this.handlers.some(handler => handler.isEnterIntent(text));
  }

  async shouldExitActiveMode(input: PipelineInput): Promise<boolean> {
    const activeState = await this.get(input.user_id, input.app_name);
    if (!activeState) return false;

    const activeHandler = this.handlers.find(handler => handler.mode === activeState.mode);
    return activeHandler?.isExitIntent(input.text) || false;
  }

  async handle(input: PipelineInput, startTotal: number): Promise<PipelineResult> {
    const activeState = await this.get(input.user_id, input.app_name);
    const target = activeState
      ? this.handlers.find(handler => handler.mode === activeState.mode)
      : this.handlers.find(handler => handler.isEnterIntent(input.text));

    if (!target) {
      throw new Error('GodModeManagerService.handle called without matching mode');
    }

    // ✅ BROADCAST: Entering god mode
    if (!activeState && target.isEnterIntent(input.text)) {
      this.broadcastModeChange(input.user_id, input.app_name, 'god-mode', target.mode);
    }

    for (const handler of this.handlers) {
      if (handler.mode !== target.mode) {
        await handler.exit(input.user_id, input.app_name);
      }
    }

    await this.set(input.user_id, input.app_name, target.mode, activeState?.enteredAt || Date.now());
    const result = await target.handle(input, startTotal);

    if (target.isExitIntent(input.text)) {
      await this.clear(input.user_id, input.app_name);
    }

    return result;
  }

  async replayActiveModeToClient(
    clientId: string,
    userId: string,
    appName: string
  ): Promise<void> {
    const activeState = await this.get(userId, appName);
    if (!activeState) return;

    const sent = chatWsService.sendToClient(clientId, {
      type: WS_MESSAGE_TYPE.NOTIFICATION,
      event: 'mode_change',
      mode: 'god-mode',
      modeName: activeState.mode,
      godModeName: activeState.mode,
      timestamp: Date.now(),
      message: `Entered ${activeState.mode} mode`,
      replay: true
    });

    appLogger.info('[GodModeManager] Active mode replayed to WebSocket client', {
      clientId,
      userId,
      appName,
      mode: activeState.mode,
      sent
    });
  }

  async clear(userId: string, appName: string): Promise<void> {
    await globalCache.del(this.key(userId, appName), {
      redisKey: this.key(userId, appName)
    });
    
    // ✅ BROADCAST: Exiting god mode (return to chat mode)
    this.broadcastModeChange(userId, appName, 'chat-mode', null);
  }

  private async findActiveHandler(userId: string, appName: string): Promise<GodModeHandler | null> {
    for (const handler of this.handlers) {
      if (await handler.isActive(userId, appName)) {
        return handler;
      }
    }
    return null;
  }

  private async set(
    userId: string,
    appName: string,
    mode: GodModeName,
    enteredAt = Date.now()
  ): Promise<void> {
    await globalCache.set(this.key(userId, appName), {
      active: true,
      mode,
      enteredAt
    }, {
      ttl: TTL_MS,
      redisKey: this.key(userId, appName)
    });
  }

  private key(userId: string, appName: string): string {
    return `god-mode:${appName}:${userId}`;
  }

  /**
   * Broadcast mode change event to user's WebSocket connections
   */
  private broadcastModeChange(
    userId: string,
    appName: string,
    mode: 'god-mode' | 'chat-mode',
    godModeName: GodModeName | null
  ): void {
    // ✅ USE REUSABLE UTILS
    broadcastModeChangeUtil(userId, mode, godModeName);
  }
}

export const godModeManagerService = new GodModeManagerService();
