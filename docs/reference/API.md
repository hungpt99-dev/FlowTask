# Programmatic API Reference

> **Status:** draft | **Last reviewed:** 2026-06-29 | **Audience:** developers

## Overview

FlowTask exposes a programmatic API for integrating with other tools and scripts.

## Provider Registration API

```typescript
import { ProviderRegistry, type AiProviderFactory } from "flowtask";

const registry = new ProviderRegistry();
registry.registerProviderType("my-vendor", myFactory: AiProviderFactory);
registry.registerProvider("my-model", { type: "my-vendor", ...config });
```

## FlowTask API

The main API is accessible via the `FlowTaskAPI` class:

(API reference to be expanded as the API surface stabilizes.)
