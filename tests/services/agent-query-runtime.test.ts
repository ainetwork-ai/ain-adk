import { AINAgent } from "@/index";
import { MemoryModule, ModelModule } from "@/modules";
import type { IMemory, BaseModel } from "@/modules";
import { MessageRole, ThreadType, type MessageObject, type ThreadObject } from "@/types/memory";

describe("AINAgent embedded query runtime", () => {
  const originalMode = process.env.DISABLE_MULTI_INTENTS;
  const fetch = jest.fn();
  const connect = jest.fn(async () => {});
  const fulfilled = jest.fn();
  const businessRead = jest.fn(() => { throw new Error("unexpected business data read"); });
  const threads = new Map<string, ThreadObject>();
  let agent: AINAgent;
  const workflow = { id: "workflow", name: "workflow", description: "Explicit overtime workflow requests", status: "active" };
  beforeAll(() => {
    process.env.DISABLE_MULTI_INTENTS = "false";
    const models = new ModelModule();
    models.addModel("fixture", { generateMessages: (input: unknown) => [input], fetch } as unknown as BaseModel<unknown, unknown>);
    const memory = new MemoryModule({
      connect, disconnect: async () => {}, isConnected: () => true,
      getAgentMemory: () => ({ getSingleTriggerPrompt: async () => "Match a registered intent only when the latest request asks for it." }),
      getIntentMemory: () => ({ listIntents: async () => [workflow], getIntentByName: async (name: string) => name === "workflow" ? workflow : undefined }),
      getThreadMemory: () => ({
        getThread: async (userId: string, threadId: string) => structuredClone(threads.get(userId + "|" + threadId)),
        addMessagesToThread: async (userId: string, threadId: string, messages: MessageObject[]) => { threads.get(userId + "|" + threadId)!.messages.push(...messages); },
      }),
      getDocumentMemory: () => undefined,
      getUserWorkflowMemory: businessRead,
      getWorkflowTemplateMemory: businessRead,
    } as unknown as IMemory);
    agent = new AINAgent({ name: "AINA fixture", description: "Embedded ADK runtime" }, {
      modelModule: models, memoryModule: memory,
      authModule: { authenticate: async () => ({ isAuthenticated: true, userId: "fixture" }) },
    }, {
      intentMode: "single",
      onIntentFallback: () => (async function* () { yield { event: "text_chunk" as const, data: { delta: "안녕하세요!" } }; })(),
      onIntentFulfill: (context) => (async function* () { fulfilled(context); yield { event: "text_chunk" as const, data: { delta: "승인 전 미리보기" } }; })(),
    });
  });
  afterAll(() => { if (originalMode === undefined) delete process.env.DISABLE_MULTI_INTENTS; else process.env.DISABLE_MULTI_INTENTS = originalMode; });
  async function query(userId: string, query: string) {
    const threadId = "thread-" + userId;
    threads.set(userId + "|" + threadId, { type: ThreadType.CHAT, userId, threadId, title: "fixture", messages: [] });
    const events = [];
    for await (const event of agent.query({ type: ThreadType.CHAT, userId, threadId }, { query })) events.push(event);
    return { events, thread: threads.get(userId + "|" + threadId)! };
  }
  it("uses ADK fallback and memory without opening a listener or looking up business data", async () => {
    fetch.mockResolvedValueOnce({ content: '{"intentName":null}' });
    const { events, thread } = await query("greeting-user", "hi");
    expect(events).toContainEqual({ event: "text_chunk", data: { delta: "안녕하세요!" } });
    expect(fulfilled).not.toHaveBeenCalled();
    expect(businessRead).not.toHaveBeenCalled();
    expect(thread.messages.map(message => message.role)).toEqual([MessageRole.USER, MessageRole.MODEL]);
  });
  it("runs a matched host executor inside the same ADK lifecycle and initializes once", async () => {
    fetch.mockResolvedValueOnce({ content: '{"intentName":"workflow"}' });
    const { events, thread } = await query("workflow-user", "초과근무 신청해줘");
    expect(events).toContainEqual({ event: "text_chunk", data: { delta: "승인 전 미리보기" } });
    expect(fulfilled).toHaveBeenCalledTimes(1);
    expect(fulfilled.mock.calls[0][0].thread.userId).toBe("workflow-user");
    expect(connect).toHaveBeenCalledTimes(1);
    expect(thread.messages).toHaveLength(2);
  });
});
