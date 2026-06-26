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
    case "argument":
      return { args: [...input.args, input.contextPackContent], stdin: undefined };
    case "file": {
      const fileArg = input.fileArg ?? "--file";
      return { args: [...input.args, fileArg, input.contextPackPath], stdin: undefined };
    }
  }
}
