"use client";

import { Button } from "@dya/ui/components/button";
import { useRef, useState, type FormEvent } from "react";
import { Conversation, ConversationContent, ConversationScrollButton } from "@dya/ui/components/ai-conversation";
import { Message, MessageContent, MessageResponse } from "@dya/ui/components/ai-message";
import { PromptInput, PromptInputTextarea, PromptInputSubmit } from "@dya/ui/components/ai-prompt-input";
import { ToolChecks } from "@dya/ui/components/ai-tool";
import { LoaderCircle } from "@dya/ui/icons";
import { ChatPopover } from "@dya/ui/components/chat-popover";
import { sendChatMessage, type ChatDraft } from "@/lib/near/http/chat-client";

export type Draft = ChatDraft;
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; draft?: Draft; checks?: Parameters<typeof ToolChecks>[0]["checks"] };

export function JevChat({ connected, walletId, market, onReview }: { connected: boolean; walletId?: string; market?: { baseAssetId: string; quoteAssetId: string }; onReview: (draft: Draft) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ phase: "idle" | "waiting" } | { phase: "error"; message: string }>({ phase: "idle" });
  const turn = useRef<{ content: string; id: string } | null>(null);
  const waiting = status.phase === "waiting";

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || waiting || !connected) return;
    if (turn.current?.content !== content) turn.current = { content, id: crypto.randomUUID() };
    const turnId = turn.current.id;
    const next: ChatMessage[] = messages.at(-1)?.id === turnId
      ? messages
      : [...messages, { id: turnId, role: "user", content }];
    setMessages(next);
    setInput("");
    setStatus({ phase: "waiting" });
    try {
      const reply = await sendChatMessage({ walletId, market, turnId, messages: next.slice(-12).map(({ role, content }) => ({ role, content })) });
      setMessages([...next, { id: crypto.randomUUID(), role: "assistant", content: reply.text, draft: reply.draft, checks: reply.checks }]);
      turn.current = null;
      setStatus({ phase: "idle" });
    } catch (error) {
      setStatus({ phase: "error", message: error instanceof Error ? error.message : "Chat couldn’t respond." });
    }
  }

  return <ChatPopover title="Chat">
    <Conversation aria-label="Chat conversation" className="min-h-0 text-sm">
      <ConversationContent className="gap-3 p-3">
      {messages.length === 0 && !connected && <p className="text-muted-foreground">Connect your wallet to use chat.</p>}
      {messages.map(message => <Message key={message.id} from={message.role}>
        {message.checks && <ToolChecks checks={message.checks} />}
        <MessageContent>
          {message.role === "assistant" ? <MessageResponse mode="static">{message.content}</MessageResponse>
            : <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        </MessageContent>
        {message.draft && <div className="space-y-1 rounded-md border p-3">
          <p className="font-medium">Limit order draft</p>
          <p>{message.draft.side === "buy" ? "Buy" : "Sell"} {message.draft.size} {message.draft[message.draft.sizeUnit]} at {message.draft.limitPrice} {message.draft.quote} per {message.draft.base}</p>
          <p className="text-muted-foreground">Expires after {message.draft.expiry}</p>
          {connected && walletId && message.draft.walletId === walletId && <Button size="sm" type="button" onClick={() => { if (message.draft) onReview(message.draft); }}>Review order</Button>}
        </div>}
      </Message>)}
      {waiting && <div role="status" className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        <span>Thinking…</span>
      </div>}
      {status.phase === "error" && <p role="alert" className="text-destructive">{status.message}</p>}
      </ConversationContent>
      <ConversationScrollButton aria-label="Jump to latest message" />
    </Conversation>
    <PromptInput onSubmit={send} className="border-t p-3">
      <PromptInputTextarea aria-label="Message" placeholder="Message" rows={2} maxLength={2000}
        value={input} onChange={event => setInput(event.target.value)} disabled={!connected} />
      <PromptInputSubmit waiting={waiting} disabled={!connected || waiting || !input.trim()} />
    </PromptInput>
  </ChatPopover>;
}
