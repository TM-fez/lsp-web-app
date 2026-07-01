import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// One shared spy for the SDK's messages.create, captured across module resets so we
// can assert on the request the client builds.
const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
    constructor(public opts: unknown) {}
  },
}));

// env parses process.env at import time, so re-import the module fresh in each test
// after stubbing the key — that's how we exercise both the dark and configured paths.
async function loadService() {
  vi.resetModules();
  return import('../../../src/core/llm/llm.service.js');
}

beforeEach(() => {
  createMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('llm.service — configuration gate (dark by default)', () => {
  it('isLlmConfigured() is false when ANTHROPIC_API_KEY is unset', async () => {
    const { isLlmConfigured } = await loadService();
    expect(isLlmConfigured()).toBe(false);
  });

  it('generateText throws a clear error and never calls the API when unconfigured', async () => {
    const { generateText } = await loadService();
    await expect(generateText({ prompt: 'hi' })).rejects.toThrow(/not configured/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('isLlmConfigured() flips true once the key is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const { isLlmConfigured } = await loadService();
    expect(isLlmConfigured()).toBe(true);
  });
});

describe('llm.service — generateText', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
  });

  it('sends the default model + token ceiling and returns the concatenated text', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ],
    });
    const { generateText } = await loadService();

    const out = await generateText({ prompt: 'greet' });

    expect(out).toBe('Hello world');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{ role: 'user', content: 'greet' }],
      }),
    );
    // No system prompt supplied → omit the field entirely.
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('system');
  });

  it('passes through system prompt and per-call overrides', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const { generateText } = await loadService();

    await generateText({ prompt: 'p', system: 'be terse', maxTokens: 256, model: 'claude-haiku-4-5' });

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5', max_tokens: 256, system: 'be terse' }),
    );
  });

  it('ignores non-text blocks (e.g. thinking) when extracting the reply', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'internal' },
        { type: 'text', text: '  the answer  ' },
      ],
    });
    const { generateText } = await loadService();

    expect(await generateText({ prompt: 'q' })).toBe('the answer');
  });
});
