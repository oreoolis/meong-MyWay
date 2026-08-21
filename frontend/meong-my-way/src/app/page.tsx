import { Workspace } from "@/components/workspace";

/**
 * The whole app is one route. Every stage — sign in, upload, the agent run,
 * the results — is a state of <Workspace/>, so the URL never changes and the
 * uploaded File object survives the entire flow.
 */
export default function Home() {
  return <Workspace />;
}
