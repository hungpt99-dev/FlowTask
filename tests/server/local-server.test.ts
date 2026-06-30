import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LocalServer, createServer } from "../../src/server/local-server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("LocalServer", () => {
  let testDir: string;
  const basePort = 23456;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "flowtask-server-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("construction", () => {
    it("binds to 127.0.0.1 by default", () => {
      const s = createServer();
      expect(s.getHost()).toBe("127.0.0.1");
    });

    it("rejects public exposure without explicit allowPublicExposure", () => {
      const s = createServer({ host: "0.0.0.0" });
      expect(s.getHost()).toBe("127.0.0.1");
    });

    it("uses provided host override with allowPublicExposure", () => {
      const s = createServer({ host: "0.0.0.0", allowPublicExposure: true });
      expect(s.getHost()).toBe("0.0.0.0");
    });

    it("allows public exposure when explicitly configured", () => {
      const s = createServer({ host: "0.0.0.0", allowPublicExposure: true });
      expect(s.getHost()).toBe("0.0.0.0");
    });

    it("uses default port when not specified", () => {
      const s = createServer();
      expect(s.getPort()).toBe(3487);
    });

    it("uses provided port", () => {
      const s = createServer({ port: 9999 });
      expect(s.getPort()).toBe(9999);
    });
  });

  describe("start and stop", () => {
    it("starts and stops without error", async () => {
      const s = createServer({ port: basePort + 1 });
      await s.start();
      expect(s.getPort()).toBe(basePort + 1);
      await s.stop();
    });

    it("starts and responds to /health", async () => {
      const s = createServer({ port: basePort + 2 });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 2}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });

      await s.stop();
    });

    it("returns 404 for unknown paths when no static dir configured", async () => {
      const s = new LocalServer({
        port: basePort + 3,
        rootPath: testDir,
        staticDir: "nonexistent",
      });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 3}/unknown`);
      expect(res.status).toBe(404);

      await s.stop();
    });

    it("can start multiple servers on different ports", async () => {
      const s1 = createServer({ port: basePort + 4 });
      const s2 = createServer({ port: basePort + 5 });
      await s1.start();
      await s2.start();

      const [r1, r2] = await Promise.all([
        fetch(`http://127.0.0.1:${basePort + 4}/health`),
        fetch(`http://127.0.0.1:${basePort + 5}/health`),
      ]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);

      await s1.stop();
      await s2.stop();
    });
  });

  describe("API routing", () => {
    it("returns 404 for unknown API endpoints", async () => {
      const s = new LocalServer({
        port: basePort + 6,
        rootPath: testDir,
      });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 6}/api/nonexistent`);
      expect(res.status).toBe(404);

      await s.stop();
    });

    it("returns project status", async () => {
      const s = new LocalServer({
        port: basePort + 7,
        rootPath: testDir,
      });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 7}/api/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("initialized");

      await s.stop();
    });

    it("returns 405 for wrong method on /api/status", async () => {
      const s = new LocalServer({ port: basePort + 8, rootPath: testDir });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 8}/api/status`, {
        method: "POST",
      });
      expect(res.status).toBe(405);

      await s.stop();
    });
  });

  describe("config API", () => {
    it("returns config keys", async () => {
      const s = new LocalServer({ port: basePort + 9, rootPath: testDir });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 9}/api/config/keys`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);

      await s.stop();
    });
  });

  describe("security", () => {
    it("does not allow path traversal in static files", async () => {
      const s = new LocalServer({
        port: basePort + 10,
        rootPath: testDir,
        staticDir: "nonexistent",
      });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 10}/../../../etc/passwd`);
      expect(res.status).toBe(404);

      await s.stop();
    });

    it("does not expose config via static serving", async () => {
      const s = new LocalServer({
        port: basePort + 11,
        rootPath: testDir,
        staticDir: "nonexistent",
      });
      await s.start();

      const res = await fetch(`http://127.0.0.1:${basePort + 11}/../config.json`);
      expect(res.status).toBe(404);

      await s.stop();
    });

    it("defaults to 127.0.0.1 not 0.0.0.0", () => {
      const s = createServer();
      expect(s.getHost()).toBe("127.0.0.1");
      expect(s.getHost()).not.toBe("0.0.0.0");
    });
  });
});

describe("createServer", () => {
  it("returns a LocalServer instance", () => {
    const s = createServer();
    expect(s).toBeInstanceOf(LocalServer);
  });
});
