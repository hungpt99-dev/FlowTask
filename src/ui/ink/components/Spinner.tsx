import { useEffect, useState } from "react";
import { Text } from "ink";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 100;

export interface SpinnerProps {
  active?: boolean;
}

export function Spinner({ active = true }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, [active]);

  return <Text color="blue">{active ? FRAMES[frame] : "●"}</Text>;
}
