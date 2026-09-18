.DEFAULT_GOAL := help

PORT = 8889

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  make serve    Start dev server → http://localhost:$(PORT)"
	@echo "  make test     Run the deck and shake tests (node, no install)"
	@echo "  make kill     Kill this project's HTTP server"
	@echo ""

# ── Dev server ────────────────────────────────────────────────────────────────
# scripts/serve.py is http.server plus Cache-Control: no-cache; a plain
# http.server sends only Last-Modified, so browsers keep stale ES modules after
# edits. Falls back to plain http.server outside the monorepo.
.PHONY: serve
serve:
	@echo "Serving → http://localhost:$(PORT)"
	@if [ -f ../../scripts/serve.py ]; then python3 ../../scripts/serve.py $(PORT); else python3 -m http.server $(PORT); fi

# ── Tests ─────────────────────────────────────────────────────────────────────
# Zero dependencies: Node's own runner, no npm install, no node_modules. Only
# the DOM-free modules are covered (js/deck.js, js/state.js, js/shake.js's
# reversal counter); the ball itself is verified in a browser.
# --disable-warning silences MODULE_TYPELESS_PACKAGE_JSON: js/ has no
# package.json on purpose and the browser loads it as <script type="module">.
NODE_TEST = node --test --disable-warning=MODULE_TYPELESS_PACKAGE_JSON

.PHONY: test
test:
	@$(NODE_TEST) tests/*.test.mjs

.PHONY: test-watch
test-watch:
	@$(NODE_TEST) --watch tests/*.test.mjs

# ── Kill ──────────────────────────────────────────────────────────────────────
.PHONY: kill
kill:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on port $(PORT)" || echo "No server running on port $(PORT)"
