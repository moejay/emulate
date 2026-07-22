import type { RouteContext } from "@emulators/core";
import { authenticateMessengerSession, createPendingMfaLink, createSession } from "../auth.js";
import { conversationResponse, messageResponse } from "../helpers.js";
import { makeFaireToken } from "../ids.js";
import { getFaireStore } from "../store.js";
import { dispatchFaireWebhook } from "../webhooks.js";
import type { FaireConversation, FaireMessage } from "../entities.js";

const BLACKLIST_MESSAGE = "Message not sent. This user isn’t available for messaging.";
const BLACKLIST_CODE = "BlockMessageException.BLACKLISTED_RECIPIENT";

function loginHeaders(sessionToken: string): Headers {
  const headers = new Headers();
  headers.set("x-if-wsat", sessionToken);
  headers.append("set-cookie", `indigofair_session=${sessionToken}; Path=/; HttpOnly`);
  return headers;
}

function messengerAuthError(message: string, status: number): Response {
  return Response.json({ message }, { status });
}

function buildMessageAuthors(brandId: string, messages: FaireMessage[]) {
  const authors = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    const token = message.author_token?.trim();
    if (!token || authors.has(token)) continue;
    if (token.startsWith("b_")) {
      authors.set(token, { token, type: "BRAND_USER", brand_tokens: [brandId], name: message.author_name ?? "Brand" });
    } else {
      authors.set(token, { token, type: "RETAILER", name: message.author_name ?? "Retailer" });
    }
  }
  return [...authors.values()];
}

function nowMs(): number {
  return Date.now();
}

function sortedMessages(messages: FaireMessage[]): FaireMessage[] {
  return [...messages].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
}

function conversationByRetailer(fs: ReturnType<typeof getFaireStore>, brandId: string, retailerToken: string) {
  return fs.conversations
    .all()
    .filter((conversation) => conversation.brand_id === brandId && conversation.retailer_token === retailerToken)
    .sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0];
}

function appendBrandMessage(
  fs: ReturnType<typeof getFaireStore>,
  conversation: FaireConversation,
  brandId: string,
  bodyText: string,
): { conversation: FaireConversation; message: FaireMessage } {
  const sentAt = nowMs();
  const token = makeFaireToken("mm", 10);
  const message = fs.messages.insert({
    token,
    brand_id: brandId,
    conversation_token: conversation.token,
    message_type: "standard",
    author_token: brandId,
    author_name: "You",
    body: bodyText,
    image_urls: [],
    timestamp_ms: sentAt,
    inline_type: null,
    inline_data: null,
  });

  const updatedConversation = fs.conversations.update(conversation.id, {
    total_messages: conversation.total_messages + 1,
    needs_reply: false,
    updated_at_ms: sentAt,
    latest_message_token: token,
    latest_message_created_at: sentAt,
    latest_message_text: bodyText,
  })!;

  return { conversation: updatedConversation, message };
}

export function messengerRoutes({ app, store }: RouteContext): void {
  const fs = () => getFaireStore(store);

  app.post("/api/v2/users/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email_address === "string" ? body.email_address.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const enableMfaMethodSelection = body.enable_mfa_method_selection === true;

    const user = fs().users.findOneBy("email", email);
    if (!user || user.password !== password) {
      return messengerAuthError("Faire login failed (401): Invalid email or password", 401);
    }

    if (user.mfa_required && enableMfaMethodSelection) {
      const link = createPendingMfaLink(store, user.user_id, user.default_brand_id);
      return c.json({
        login_state: "MFA_REQUIRED",
        mfa_title: user.mfa_title,
        mfa_description: `${user.mfa_description} Use ${new URL(`/?iflt=${link.iflt}&iflc=${link.iflc}`, c.req.url).toString()}`,
      });
    }

    const session = createSession(store, user, user.default_brand_id);
    const headers = loginHeaders(session.session_token);
    return new Response(
      JSON.stringify({
        brand_token: user.default_brand_id,
        brand: { token: user.default_brand_id },
        user: {
          email: user.email,
          brand: { token: user.default_brand_id },
        },
      }),
      {
        status: 200,
        headers,
      },
    );
  });

  app.post("/api/user/switch-account", async (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const brandToken = typeof body.brand_token === "string" ? body.brand_token.trim() : "";
    if (!brandToken || !auth.user.brand_ids.includes(brandToken)) {
      return messengerAuthError("Brand not available for this Faire account", 403);
    }

    const session = createSession(store, auth.user, brandToken);
    return new Response(null, { status: 200, headers: loginHeaders(session.session_token) });
  });

  app.get("/api/v3/messenger/retailer-conversation/:retailerToken", (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;

    const retailerToken = c.req.param("retailerToken");
    const conversation = conversationByRetailer(fs(), auth.brandId, retailerToken);
    if (conversation) {
      return c.json({ conversation: conversationResponse(conversation) });
    }

    const retailer = fs().retailers.findOneBy("retailer_id", retailerToken);
    if (!retailer) return c.json({ message: "Conversation not found" }, 404);
    return c.json({
      conversation: {
        retailer_token: retailer.retailer_id,
        other_party_company: retailer.name,
        total_messages: 0,
        unread_messages: 0,
        needs_reply: false,
        updated_at: nowMs(),
        is_accepting_messages: retailer.accepting_messages,
      },
    });
  });

  app.post("/api/messenger/list-conversations", async (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const paginationToken = typeof body.pagination_token === "string" ? body.pagination_token : "";
    const offset = paginationToken ? parseInt(Buffer.from(paginationToken, "base64url").toString("utf8"), 10) || 0 : 0;
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 50;

    const conversations = fs()
      .conversations.all()
      .filter((conversation) => conversation.brand_id === auth.brandId && conversation.include_in_list && conversation.token.trim())
      .sort((a, b) => b.updated_at_ms - a.updated_at_ms);

    const page = conversations.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextRequest = nextOffset < conversations.length
      ? { pagination_token: Buffer.from(String(nextOffset), "utf8").toString("base64url"), limit }
      : undefined;

    return c.json({
      conversations: page.map(conversationResponse),
      has_more: Boolean(nextRequest),
      ...(nextRequest ? { next_request: nextRequest } : {}),
    });
  });

  app.post("/api/v3/messenger/list-messages-page", async (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationToken = typeof body.conversation_token === "string" ? body.conversation_token.trim() : "";
    const afterTimestamp = typeof body.after_timestamp === "number" ? body.after_timestamp : undefined;
    const paginationToken = typeof body.pagination_token === "string" ? body.pagination_token : "";
    const offset = paginationToken ? parseInt(Buffer.from(paginationToken, "base64url").toString("utf8"), 10) || 0 : 0;
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 200) : 200;

    const conversation = fs().conversations.findOneBy("token", conversationToken);
    if (!conversation || conversation.brand_id !== auth.brandId) {
      return c.json({ message: "Conversation not found" }, 404);
    }

    const messages = sortedMessages(
      fs()
        .messages.all()
        .filter((message) => {
          if (message.brand_id !== auth.brandId || message.conversation_token !== conversationToken) return false;
          if (afterTimestamp !== undefined && message.timestamp_ms <= afterTimestamp) return false;
          return true;
        }),
    );

    const page = messages.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    const nextToken = nextOffset < messages.length ? Buffer.from(String(nextOffset), "utf8").toString("base64url") : undefined;
    return c.json({
      messages: page.map(messageResponse),
      message_authors: buildMessageAuthors(auth.brandId, page),
      has_more: Boolean(nextToken),
      ...(nextToken ? { pagination_token: nextToken } : {}),
    });
  });

  app.post("/api/v3/messenger/create-conversation", async (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const retailerToken = typeof (body.other_participant_token as Record<string, unknown> | undefined)?.retailer_token === "string"
      ? String((body.other_participant_token as Record<string, unknown>).retailer_token)
      : "";
    const bodyText = typeof (body.message_contents as Record<string, unknown> | undefined)?.text === "string"
      ? String((body.message_contents as Record<string, unknown>).text)
      : "";

    const retailer = fs().retailers.findOneBy("retailer_id", retailerToken);
    if (!retailer) return c.json({ message: "Retailer not found" }, 404);
    if (!retailer.accepting_messages) {
      return c.json({ status_code: 400, message: BLACKLIST_MESSAGE, service_error_code: BLACKLIST_CODE }, 400);
    }

    const existing = conversationByRetailer(fs(), auth.brandId, retailerToken);
    if (existing && existing.token.trim()) {
      const appended = appendBrandMessage(fs(), existing, auth.brandId, bodyText);
      await dispatchFaireWebhook(store, {
        brandId: auth.brandId,
        event: "message.sent",
        payload: { conversation: conversationResponse(appended.conversation), message: messageResponse(appended.message) },
      });
      return c.json({ conversation: conversationResponse(appended.conversation) });
    }

    const sentAt = nowMs();
    const token = makeFaireToken("mc", 10);
    const messageToken = makeFaireToken("mm", 10);
    const conversation = fs().conversations.insert({
      token,
      brand_id: auth.brandId,
      retailer_token: retailerToken,
      retailer_name: retailer.name,
      is_accepting_messages: true,
      include_in_list: true,
      total_messages: 1,
      unread_messages: 0,
      needs_reply: false,
      updated_at_ms: sentAt,
      latest_message_text: bodyText,
      latest_message_token: messageToken,
      latest_message_created_at: sentAt,
    });
    const message = fs().messages.insert({
      token: messageToken,
      brand_id: auth.brandId,
      conversation_token: token,
      message_type: "standard",
      author_token: auth.brandId,
      author_name: "You",
      body: bodyText,
      image_urls: [],
      timestamp_ms: sentAt,
      inline_type: null,
      inline_data: null,
    });

    await dispatchFaireWebhook(store, {
      brandId: auth.brandId,
      event: "conversation.created",
      payload: { conversation: conversationResponse(conversation), message: messageResponse(message) },
    });

    return c.json({ conversation: conversationResponse(conversation) });
  });

  app.post("/api/v3/messenger/send-message", async (c) => {
    const auth = authenticateMessengerSession(c, store);
    if (!auth.ok) return auth.response;
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationToken = typeof body.conversation_token === "string" ? body.conversation_token.trim() : "";
    const bodyText = typeof (body.message_contents as Record<string, unknown> | undefined)?.text === "string"
      ? String((body.message_contents as Record<string, unknown>).text)
      : "";

    const conversation = fs().conversations.findOneBy("token", conversationToken);
    if (!conversation || conversation.brand_id !== auth.brandId) {
      return c.json({ message: "Conversation not found" }, 404);
    }

    const retailer = fs().retailers.findOneBy("retailer_id", conversation.retailer_token);
    if (retailer && !retailer.accepting_messages) {
      return c.json({ status_code: 400, message: BLACKLIST_MESSAGE, service_error_code: BLACKLIST_CODE }, 400);
    }

    const appended = appendBrandMessage(fs(), conversation, auth.brandId, bodyText);
    await dispatchFaireWebhook(store, {
      brandId: auth.brandId,
      event: "message.sent",
      payload: { conversation: conversationResponse(appended.conversation), message: messageResponse(appended.message) },
    });
    return c.json({ conversation: conversationResponse(appended.conversation) });
  });
}
