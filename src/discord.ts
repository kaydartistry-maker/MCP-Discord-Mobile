// Discord REST API wrapper - no discord.js dependency
// Pure fetch-based client for Cloudflare Workers

const DISCORD_API = 'https://discord.com/api/v10';

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  timestamp: string;
  attachments: any[];
  embeds: any[];
  message_reference?: {
    message_id: string;
  };
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  member_count?: number;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  topic?: string;
}

export class DiscordClient {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${DISCORD_API}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error ${response.status}: ${error}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  // ============ MESSAGES ============

  async readMessages(channelId: string, limit: number = 50): Promise<DiscordMessage[]> {
    const messages = await this.request<DiscordMessage[]>(
      `/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`
    );

    // Sort oldest first (Discord returns newest first)
    return messages.reverse();
  }

  async sendMessage(
    channelId: string,
    content: string,
    replyToMessageId?: string
  ): Promise<DiscordMessage> {
    const body: any = { content };

    if (replyToMessageId) {
      body.message_reference = { message_id: replyToMessageId };
    }

    return this.request<DiscordMessage>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  async searchMessages(
    guildId: string,
    params: {
      content?: string;
      author_id?: string;
      channel_id?: string;
      has?: string;
      limit?: number;
    }
  ): Promise<{ messages: DiscordMessage[][]; total_results: number }> {
    const searchParams = new URLSearchParams();

    if (params.content) searchParams.set('content', params.content);
    if (params.author_id) searchParams.set('author_id', params.author_id);
    if (params.channel_id) searchParams.set('channel_id', params.channel_id);
    if (params.has) searchParams.set('has', params.has);
    if (params.limit) searchParams.set('limit', String(Math.min(params.limit, 25)));

    return this.request<{ messages: DiscordMessage[][]; total_results: number }>(
      `/guilds/${guildId}/messages/search?${searchParams.toString()}`
    );
  }

  // ============ REACTIONS ============

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    // Encode emoji for URL (handle both unicode and custom emoji)
    const encodedEmoji = encodeURIComponent(emoji);

    await this.request<void>(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      { method: 'PUT' }
    );
  }

  // ============ FILE ATTACHMENTS ============

  async sendFileAttachment(
    channelId: string,
    fileData: Uint8Array,
    filename: string,
    contentType: string,
    messageContent?: string
  ): Promise<DiscordMessage> {
    const url = `${DISCORD_API}/channels/${channelId}/messages`;

    const formData = new FormData();
    const blob = new Blob([fileData], { type: contentType });
    formData.append('files[0]', blob, filename);

    const payload: any = {
      attachments: [{ id: '0', filename }],
    };
    if (messageContent) {
      payload.content = messageContent;
    }
    formData.append('payload_json', JSON.stringify(payload));

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error ${response.status}: ${error}`);
    }

    return response.json();
  }

  // ============ VOICE MESSAGES ============

  async sendVoiceMessage(
    channelId: string,
    oggData: Uint8Array,
    durationSecs: number,
    waveform: string
  ): Promise<DiscordMessage> {
    // Step 1: Request a pre-signed upload URL from Discord
    const uploadRequest = await this.request<{
      attachments: Array<{
        id: string;
        upload_url: string;
        upload_filename: string;
      }>;
    }>(
      `/channels/${channelId}/attachments`,
      {
        method: 'POST',
        body: JSON.stringify({
          files: [{
            filename: 'voice-message.ogg',
            file_size: oggData.length,
            id: '0',
          }],
        }),
      }
    );

    const { upload_url, upload_filename } = uploadRequest.attachments[0];

    // Step 2: Upload OGG data to Discord's CDN (no auth header — URL is pre-signed)
    const uploadResponse = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/ogg' },
      body: oggData,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Discord upload error ${uploadResponse.status}: ${error}`);
    }

    // Step 3: Send the message with voice message flag
    return this.request<DiscordMessage>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          flags: 8192,
          attachments: [{
            id: '0',
            filename: 'voice-message.ogg',
            uploaded_filename: upload_filename,
            duration_secs: durationSecs,
            waveform: waveform,
          }],
        }),
      }
    );
  }

  // ============ EDIT & DELETE ============

  async editMessage(
    channelId: string,
    messageId: string,
    content: string
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(
      `/channels/${channelId}/messages/${messageId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      }
    );
  }

  async deleteMessage(
    channelId: string,
    messageId: string
  ): Promise<void> {
    await this.request<void>(
      `/channels/${channelId}/messages/${messageId}`,
      { method: 'DELETE' }
    );
  }

  // ============ TYPING ============

  async triggerTyping(channelId: string): Promise<void> {
    await this.request<void>(
      `/channels/${channelId}/typing`,
      { method: 'POST' }
    );
  }

  // ============ IMAGES ============

  async sendImage(
    channelId: string,
    url: string,
    description?: string
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          embeds: [{
            image: { url },
            ...(description ? { description } : {}),
          }],
        }),
      }
    );
  }

  // ============ EMOJIS ============

  async listEmojis(guildId: string): Promise<any[]> {
    return this.request<any[]>(`/guilds/${guildId}/emojis`);
  }

  // ============ STICKERS ============

  async listStickers(guildId: string): Promise<any[]> {
    return this.request<any[]>(`/guilds/${guildId}/stickers`);
  }

  async sendSticker(
    channelId: string,
    stickerId: string
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(
      `/channels/${channelId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ sticker_ids: [stickerId] }),
      }
    );
  }

  // ============ SERVERS ============

  async listGuilds(): Promise<DiscordGuild[]> {
    return this.request<DiscordGuild[]>('/users/@me/guilds');
  }

  async getGuild(guildId: string): Promise<DiscordGuild> {
    return this.request<DiscordGuild>(`/guilds/${guildId}?with_counts=true`);
  }

  async getGuildChannels(guildId: string): Promise<DiscordChannel[]> {
    return this.request<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  }
}
