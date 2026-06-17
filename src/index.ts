// Discord MCP Worker - Discord access from anywhere via Cloudflare Workers
// Lightweight REST-based MCP for mobile Claude and browser clients

import { DiscordClient } from './discord';

const DISCORD_CDN = 'https://cdn.discordapp.com';

interface Env {
  DISCORD_TOKEN: string;
  MCP_SECRET: string;
}

interface MCPRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, any>;
  };
}

interface MCPResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string };
}

// Tool definitions for MCP
const TOOLS = [
  {
    name: 'discord_read_messages',
    description: 'Read messages from a Discord channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to read from' },
        limit: { type: 'number', description: 'Number of messages (max 100)', default: 50 },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_send',
    description: 'Send a message to a Discord channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        message: { type: 'string', description: 'The message content' },
        replyToMessageId: { type: 'string', description: 'Optional message ID to reply to' },
      },
      required: ['channelId', 'message'],
    },
  },
  {
    name: 'discord_search_messages',
    description: 'Search for messages in a Discord server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID to search' },
        content: { type: 'string', description: 'Text to search for' },
        authorId: { type: 'string', description: 'Filter by author ID' },
        channelId: { type: 'string', description: 'Filter by channel ID' },
        has: { type: 'string', description: 'Filter by content type (link, embed, file, image, video)' },
        limit: { type: 'number', description: 'Max results (default 25)' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_add_reaction',
    description: 'Add a reaction to a message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to react to' },
        emoji: { type: 'string', description: 'The emoji to react with' },
      },
      required: ['channelId', 'messageId', 'emoji'],
    },
  },
  {
    name: 'discord_list_servers',
    description: 'List all Discord servers the bot is in',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'discord_get_server_info',
    description: 'Get detailed info about a Discord server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_edit_message',
    description: 'Edit a previously sent message',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to edit' },
        content: { type: 'string', description: 'The new message content' },
      },
      required: ['channelId', 'messageId', 'content'],
    },
  },
  {
    name: 'discord_delete_message',
    description: 'Delete a message from a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        messageId: { type: 'string', description: 'The message ID to delete' },
      },
      required: ['channelId', 'messageId'],
    },
  },
  {
    name: 'discord_typing',
    description: 'Show a typing indicator in a channel (lasts ~10 seconds)',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'discord_send_image',
    description: 'Send an image to a channel via URL embed',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID to send to' },
        url: { type: 'string', description: 'The image URL' },
        description: { type: 'string', description: 'Optional image description/caption' },
      },
      required: ['channelId', 'url'],
    },
  },
  {
    name: 'discord_list_emojis',
    description: 'List all custom emojis in a server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_list_stickers',
    description: 'List all stickers in a server',
    inputSchema: {
      type: 'object',
      properties: {
        guildId: { type: 'string', description: 'The server (guild) ID' },
      },
      required: ['guildId'],
    },
  },
  {
    name: 'discord_send_sticker',
    description: 'Send a sticker to a channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'The channel ID' },
        stickerId: { type: 'string', description: 'The sticker ID to send' },
      },
      required: ['channelId', 'stickerId'],
    },
  },
];

// ============ EMOTE RESOLVER ============

const EMOTE_REGEX = /<(a?):(\w+):(\d+)>/g;

function resolveEmotes(content: string): { code: string; name: string; id: string; animated: boolean; url: string; mimeType: string }[] {
  if (!content || typeof content !== 'string') return [];

  const emotes: { code: string; name: string; id: string; animated: boolean; url: string; mimeType: string }[] = [];
  let match;
  EMOTE_REGEX.lastIndex = 0;

  while ((match = EMOTE_REGEX.exec(content)) !== null) {
    const [fullCode, animatedFlag, name, id] = match;
    const extension = animatedFlag === 'a' ? 'gif' : 'png';
    const mimeType = animatedFlag === 'a' ? 'image/gif' : 'image/png';
    emotes.push({
      code: fullCode,
      name,
      id,
      animated: animatedFlag === 'a',
      url: `${DISCORD_CDN}/emojis/${id}.${extension}?size=128`,
      mimeType,
    });
  }

  return emotes;
}

// ============ EMBED RESOLVER ============

function resolveEmbedImages(embeds: any[]): { url: string; source: string; title: string | null }[] {
  if (!Array.isArray(embeds) || embeds.length === 0) return [];

  const images: { url: string; source: string; title: string | null }[] = [];
  for (const embed of embeds) {
    if (embed.image?.url) {
      images.push({ url: embed.image.url, source: embed.type || 'image', title: embed.title || null });
    } else if (embed.thumbnail?.url) {
      images.push({ url: embed.thumbnail.url, source: embed.type || 'thumbnail', title: embed.title || null });
    } else if (embed.video?.url) {
      images.push({ url: embed.video.url, source: embed.type || 'video', title: embed.title || null });
    }
  }
  return images;
}

// ============ ATTACHMENT RESOLVER ============

function resolveImageAttachments(attachments: any[]): { url: string; filename: string; contentType: string; size: number }[] {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const images: { url: string; filename: string; contentType: string; size: number }[] = [];
  for (const att of attachments) {
    const contentType = att.content_type || '';
    if (contentType.startsWith('image/')) {
      images.push({
        url: att.url,
        filename: att.filename || 'image',
        contentType,
        size: att.size || 0,
      });
    }
  }
  return images;
}

// ============ IMAGE FETCH ============

async function fetchImageAsBlock(imageMeta: { url: string; mimeType?: string }): Promise<{ type: string; data: string; mimeType: string } | null> {
  try {
    const response = await fetch(imageMeta.url, { headers: { 'Accept': 'image/gif,image/*' } });
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );
    const contentType = response.headers.get('content-type') || imageMeta.mimeType || 'image/png';

    return {
      type: 'image',
      data: base64,
      mimeType: contentType,
    };
  } catch {
    return null;
  }
}

async function handleToolCall(
  client: DiscordClient,
  name: string,
  args: Record<string, any>
): Promise<{ content: any[]; isError?: boolean }> {
  try {
    switch (name) {
      case 'discord_read_messages': {
        const messages = await client.readMessages(args.channelId, args.limit || 50);
        const contentBlocks: any[] = [];
        const allImageMetas: { url: string; mimeType?: string; label: string }[] = [];

        const formatted = messages.map((m) => {
          const emotes = resolveEmotes(m.content);
          const embedImages = resolveEmbedImages(m.embeds);
          const imageAttachments = resolveImageAttachments(m.attachments);

          // Collect images for fetching
          for (const att of imageAttachments) {
            allImageMetas.push({ url: att.url, mimeType: att.contentType, label: `${m.author.username}: ${att.filename}` });
          }
          for (const img of embedImages) {
            allImageMetas.push({ url: img.url, label: `${m.author.username}: embed (${img.source})` });
          }

          return {
            id: m.id,
            content: m.content,
            author: {
              id: m.author.id,
              username: m.author.username,
              bot: m.author.bot,
            },
            timestamp: m.timestamp,
            emotes: emotes.length > 0 ? emotes : undefined,
            imageAttachments: imageAttachments.length > 0 ? imageAttachments : undefined,
            embedImages: embedImages.length > 0 ? embedImages : undefined,
            replyTo: m.message_reference?.message_id || null,
          };
        });

        contentBlocks.push({
          type: 'text',
          text: JSON.stringify(
            { channelId: args.channelId, messageCount: formatted.length, messages: formatted },
            null,
            2
          ),
        });

        // Fetch actual images (cap at 10 to avoid timeouts)
        const imagesToFetch = allImageMetas.slice(0, 10);
        const imageResults = await Promise.all(
          imagesToFetch.map(async (meta) => {
            const block = await fetchImageAsBlock(meta);
            return block ? { block, label: meta.label } : null;
          })
        );

        for (const result of imageResults) {
          if (result) {
            contentBlocks.push({ type: 'text', text: `📎 ${result.label}` });
            contentBlocks.push(result.block);
          }
        }

        return { content: contentBlocks };
      }

      case 'discord_send': {
        await client.sendMessage(args.channelId, args.message, args.replyToMessageId);
        const response = args.replyToMessageId
          ? `Message sent to ${args.channelId} as reply to ${args.replyToMessageId}`
          : `Message sent to ${args.channelId}`;
        return { content: [{ type: 'text', text: response }] };
      }

      case 'discord_search_messages': {
        const results = await client.searchMessages(args.guildId, {
          content: args.content,
          author_id: args.authorId,
          channel_id: args.channelId,
          has: args.has,
          limit: args.limit,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { totalResults: results.total_results, messages: results.messages },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_add_reaction': {
        await client.addReaction(args.channelId, args.messageId, args.emoji);
        return {
          content: [{ type: 'text', text: `Added reaction ${args.emoji} to message ${args.messageId}` }],
        };
      }

      case 'discord_list_servers': {
        const guilds = await client.listGuilds();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                guilds.map((g) => ({ id: g.id, name: g.name })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_get_server_info': {
        const [guild, channels] = await Promise.all([
          client.getGuild(args.guildId),
          client.getGuildChannels(args.guildId),
        ]);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  id: guild.id,
                  name: guild.name,
                  memberCount: guild.member_count,
                  channels: channels.map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_edit_message': {
        await client.editMessage(args.channelId, args.messageId, args.content);
        return {
          content: [{ type: 'text', text: `Message ${args.messageId} edited in ${args.channelId}` }],
        };
      }

      case 'discord_delete_message': {
        await client.deleteMessage(args.channelId, args.messageId);
        return {
          content: [{ type: 'text', text: `Message ${args.messageId} deleted from ${args.channelId}` }],
        };
      }

      case 'discord_typing': {
        await client.triggerTyping(args.channelId);
        return {
          content: [{ type: 'text', text: `Typing indicator triggered in ${args.channelId}` }],
        };
      }

      case 'discord_send_image': {
        await client.sendImage(args.channelId, args.url, args.description);
        return {
          content: [{ type: 'text', text: `Image sent to ${args.channelId}` }],
        };
      }

      case 'discord_list_emojis': {
        const emojis = await client.listEmojis(args.guildId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                emojis.map((e: any) => ({
                  id: e.id,
                  name: e.name,
                  animated: e.animated,
                  usage: `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_list_stickers': {
        const stickers = await client.listStickers(args.guildId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                stickers.map((s: any) => ({
                  id: s.id,
                  name: s.name,
                  description: s.description,
                  tags: s.tags,
                })),
                null,
                2
              ),
            },
          ],
        };
      }

      case 'discord_send_sticker': {
        await client.sendSticker(args.channelId, args.stickerId);
        return {
          content: [{ type: 'text', text: `Sticker ${args.stickerId} sent to ${args.channelId}` }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight FIRST (before any auth)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Expect URL format: /mcp/SECRET_KEY
    if (pathParts.length < 2 || pathParts[0] !== 'mcp') {
      return new Response(JSON.stringify({ error: 'Invalid path. Use /mcp/YOUR_SECRET' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const providedSecret = pathParts[1];
    if (providedSecret !== env.MCP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Handle GET requests (some MCP clients probe with GET first)
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'discord-mcp',
        version: '1.0.0',
        status: 'ok'
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Only accept POST for actual MCP calls
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const client = new DiscordClient(env.DISCORD_TOKEN);

    try {
      const body: MCPRequest = await request.json();
      const requestId = body.id ?? 1;
      let response: MCPResponse;

      switch (body.method) {
        case 'initialize':
          response = {
            jsonrpc: '2.0',
            id: requestId,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'discord-mcp', version: '1.0.0' },
            },
          };
          break;

        case 'tools/list':
          response = { jsonrpc: '2.0', id: requestId, result: { tools: TOOLS } };
          break;

        case 'tools/call':
          if (!body.params?.name) {
            response = { jsonrpc: '2.0', id: requestId, error: { code: -32602, message: 'Missing tool name' } };
          } else {
            const result = await handleToolCall(client, body.params.name, body.params.arguments || {});
            response = { jsonrpc: '2.0', id: requestId, result };
          }
          break;

        default:
          response = { jsonrpc: '2.0', id: requestId, error: { code: -32601, message: `Unknown method: ${body.method}` } };
      }

      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
