const MAX_ARG_LENGTH = 4_096;

export function buildCommandArgs(input: {
  args: string[];
  inputMode: "stdin" | "argument" | "file";
  contextPackContent: string;
  contextPackPath: string;
  fileArg?: string;
}): {
  args: string[];
  stdin?: string;
} {
  switch (input.inputMode) {
    case "stdin":
      return { args: input.args, stdin: input.contextPackContent };
    case "argument": {
      const truncated =
        input.contextPackContent.length > MAX_ARG_LENGTH
          ? input.contextPackContent.slice(0, MAX_ARG_LENGTH) + "\n... [truncated]"
          : input.contextPackContent;
      return { args: [...input.args, truncated], stdin: undefined };
    }
    case "file": {
      const fileArg = input.fileArg ?? "--file";
      return { args: [...input.args, fileArg, input.contextPackPath], stdin: undefined };
    }
  }
}
