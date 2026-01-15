# Modifying Skyvern for custom AI backends

Skyvern's architecture is **highly modular and already supports custom LLM backends** through its LiteLLM abstraction layer. The framework uses a pluggable `LLMConfigRegistry` system that enables switching between providers via environment variables—including full support for OpenAI-compatible endpoints, which means any local model server (Ollama, vLLM, LiteLLM proxy) can serve as the AI backend. For Windsurf Cascade integration, MCP (Model Context Protocol) emerges as the most viable path, though significant engineering would be required.

## Skyvern's multi-agent architecture drives browser automation

Skyvern evolved from a single-actor design to a sophisticated **Planner-Actor-Validator loop** in version 2.0. The **Planner Agent** decomposes complex objectives into sub-goals while maintaining working memory. The **Actor Agent** executes immediate browser actions (click, type, navigate) using Vision-LLM to identify elements visually. The **Validator Agent** confirms goal completion and triggers retry/recovery on failure.

The critical insight is that Skyvern uses **visual reasoning** rather than DOM selectors. It takes screenshots, feeds them to a Vision LLM (GPT-4o, Claude 3.5), and asks the model to identify elements that "look like" the target. This makes it resilient to layout changes but requires vision-capable models.

**Key architectural components** in the codebase:
- `skyvern/forge/agent.py` — ForgeAgent orchestrator coordinating all agents
- `skyvern/forge/prompts/` — **50+ Jinja2 templates** for different scenarios
- `skyvern/webeye/actions/handler.py` — ActionHandler executing browser actions
- `skyvern/webeye/scraper/scraper.py` — ScrapedPage combining DOM + screenshots
- `skyvern/forge/sdk/api/llm/` — LLM client abstraction module

## LiteLLM abstraction makes provider swapping straightforward

All LLM calls flow through **LiteLLM's unified interface**, making Skyvern provider-agnostic. The `api_handler_factory.py` file contains the core `llm_api_handler()` function that routes requests:

```python
response = await litellm.acompletion(
    model=config.model_name,
    messages=messages,
    api_key=api_key,
    api_base=api_base,  # For custom endpoints
)
```

**Supported providers** include OpenAI (GPT-4o, O3), Anthropic (Claude 3.5/4), Azure OpenAI, AWS Bedrock, Google Gemini, Ollama, and crucially **any OpenAI-compatible endpoint**.

For custom backends, configure these environment variables:

| Variable | Purpose |
|----------|---------|
| `LLM_KEY=OPENAI_COMPATIBLE` | Primary provider selector |
| `OPENAI_COMPATIBLE_API_BASE` | Custom endpoint URL (e.g., `http://localhost:4000/v1`) |
| `OPENAI_COMPATIBLE_MODEL_NAME` | Model identifier with LiteLLM prefix (e.g., `openai/your-model`) |
| `OPENAI_COMPATIBLE_SUPPORTS_VISION` | Enable for multimodal models |
| `ENABLE_OLLAMA=true` | Direct Ollama integration |
| `OLLAMA_SERVER_URL` | Ollama endpoint (e.g., `http://localhost:11434`) |

The model name **must follow LiteLLM's provider prefix format** (e.g., `openai/model-name` for OpenAI-compatible endpoints)—this is a common gotcha that causes silent failures.

## Vision processing pipeline requires multimodal models

Skyvern's screenshot processing pipeline in `webeye/utils/page.py` captures viewport screenshots and **tiles full pages into 1072×1072 chunks** optimized for Claude's Vision API. The `ScrapedPage` class combines screenshot data with DOM element trees extracted via `domUtils.js`.

This creates a practical constraint: **custom backends must support vision/multimodal inputs**. For Ollama, this means models like `qwen3-vl`, `llava`, or `minicpm-v` with the `OLLAMA_SUPPORTS_VISION=true` flag. Text-only models cannot drive Skyvern's core navigation loop.

Prompts are rendered via `load_prompt_with_elements()` in the prompt engine, injecting the navigation goal, element tree, and screenshot into Jinja2 templates. The LLM returns structured JSON specifying action type, target element ID, and input values:

```json
{"action_type": "click", "element_id": "button-42", "value": null}
```

## Alternative projects offer different LLM integration patterns

**Browser Use** (72.5k stars) takes a different approach—DOM-based text parsing instead of screenshots, with LangChain providing LLM modularity. Any LangChain-compatible model works, making local model integration easier since vision isn't required.

**LaVague** explicitly designed for local LLM privacy, using RAG on HTML chunks rather than vision. This enables smaller models like Gemma-7b to drive automation effectively.

**Nanobrowser** offers the most flexible configuration: different models per agent (Planner vs Navigator), explicit OpenAI-compatible endpoint support, and strong Ollama integration with recommended local models (Qwen3-30B, Falcon3 10B).

| Project | LLM Approach | Vision Required | Local Model Support |
|---------|--------------|-----------------|---------------------|
| Skyvern | LiteLLM abstraction | Yes | Ollama + OpenAI-compatible |
| Browser Use | LangChain-based | No | Any LangChain model |
| LaVague | Contexts system | No | Native (Gemma-7b) |
| Nanobrowser | Per-agent models | No | Ollama (excellent) |

## Windsurf Cascade integration requires MCP bridge architecture

There is **no public API for programmatically controlling Cascade**—the Enterprise API only covers analytics and usage management. However, **Model Context Protocol (MCP)** provides the officially supported extensibility path.

The most viable integration pattern: build an **MCP server wrapping Skyvern's browser capabilities** that Cascade can invoke as a tool. Configure in `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "skyvern-browser": {
      "serverUrl": "http://localhost:8000/mcp",
      "headers": {"Authorization": "Bearer ${env:SKYVERN_API_KEY}"}
    }
  }
}
```

A community project called **windsurfinabox** demonstrates headless Cascade operation using Xvfb virtual displays, xdotool for keyboard simulation, and file-based prompt injection (`windsurf-instructions.txt` → processing → `windsurf-output.txt`). This requires Docker orchestration and isn't officially supported, but proves the concept is technically feasible.

A "headless Cascade" would involve: input prompts via file or MCP request → virtual display running full Windsurf → file changes plus output log → completion signaling. This is complex but achievable for determined implementers.

## Enterprise SSO works through persistent browser profiles

Skyvern uses **Playwright** for browser automation, supporting headless and headful modes. The `BrowserManager` handles session management, and the API exposes **CDP (Chrome DevTools Protocol) connection addresses** for browser sessions.

**Critical limitation**: Skyvern cannot natively attach to an existing external Chrome window launched independently. GitHub Discussion #2009 confirms this is a known user request without current solution. The workaround involves copying browser profiles rather than direct session attachment.

For enterprise SSO scenarios, Skyvern's **Persistent Browser Sessions** (beta) enable:
- Session state persistence between workflow runs
- Cookie and localStorage preservation  
- Browser Profile export after manual SSO authentication
- Reuse of authenticated state across multiple tasks

The recommended enterprise workflow:
1. Complete SSO authentication manually in a browser session
2. Export the browser profile via Skyvern's Profiles feature
3. Load saved state in subsequent automation runs
4. Configure TOTP credentials for 2FA that Skyvern handles automatically

**Chrome 136+ compatibility note**: Chrome now refuses CDP connections using the default user_data_dir, so Skyvern copies profiles to `./tmp/user_data_dir` automatically.

## Practical implementation path for custom AI backends

For **immediate custom backend deployment**, the simplest approach:

1. Deploy LiteLLM proxy or vLLM server with a vision-capable model
2. Set `LLM_KEY=OPENAI_COMPATIBLE` and configure endpoint variables
3. Ensure model name uses correct LiteLLM prefix format
4. Test with Skyvern's evaluation datasets

For **Cascade integration**, the realistic path involves:
1. Build MCP server exposing Skyvern's task/workflow APIs
2. Configure Cascade to use Skyvern tools via MCP
3. Cascade handles high-level reasoning; Skyvern executes browser actions
4. Structure prompts so Cascade's output maps to Skyvern task definitions

For **enterprise SSO** with managed Chrome:
1. Use human-in-the-loop pattern for initial authentication
2. Capture browser profile with authenticated state
3. Configure `persist_browser_session: true` in workflows
4. Handle token refresh via Skyvern's credential management

## Conclusion

Skyvern's LiteLLM abstraction makes it **remarkably easy to swap LLM backends**—environment variables alone can point to any OpenAI-compatible endpoint or Ollama instance. The primary constraint is **vision model requirement**, which limits truly local deployment to capable multimodal models.

Cascade integration is technically possible through MCP but requires significant custom development—no turn-key solution exists. Enterprise SSO scenarios are best handled through persistent browser profiles and human-in-the-loop initial authentication rather than attempting to attach to existing browser sessions.

For teams prioritizing local/custom LLM backends, **Browser Use** (DOM-based, no vision required) or **Nanobrowser** (explicit multi-model configuration) may offer easier paths than modifying Skyvern's vision-dependent architecture.