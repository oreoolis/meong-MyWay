import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnalysisChatSource, ChatMessage as ChatMessageValue } from "@/lib/chat/contracts";
import styles from "./analysis-chat.module.css";

const LABELS: Record<AnalysisChatSource, string> = {
  profile: "Profile",
  questionnaire: "Questionnaire",
  planner: "Career Planner",
  improver: "Resume Improver",
  advisor: "Industry Advisor",
  transitioner: "Career Transitioner",
};

const SOURCE_PATTERN = /\[(Profile|Questionnaire|Career Planner|Resume Improver|Industry Advisor|Career Transitioner)\]/g;
const SOURCE_BY_LABEL: Record<string, AnalysisChatSource> = Object.fromEntries(
  Object.entries(LABELS).map(([source, label]) => [label, source]),
) as Record<string, AnalysisChatSource>;
const SOURCE_HREF_PREFIX = "#myway-source-";

function inlineSourceLinks(content: string, available: AnalysisChatSource[] = []) {
  return content.replace(SOURCE_PATTERN, (marker, label: string) => {
    const source = SOURCE_BY_LABEL[label];
    return source && available.includes(source)
      ? `[${label}](${SOURCE_HREF_PREFIX}${source})`
      : marker;
  });
}

export function ChatMessage({ message }: { message: ChatMessageValue }) {
  const markdown = inlineSourceLinks(message.content, message.sources).trim();
  return (
    <article className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
      <span className={styles.messageRole}>{message.role === "user" ? "You" : "MyWay guide"}</span>
      <div className={styles.messageBody}>
        {message.content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ children, href, ...props }) => {
                if (href?.startsWith(SOURCE_HREF_PREFIX)) {
                  const source = href.slice(SOURCE_HREF_PREFIX.length);
                  return <span className={styles.inlineSource} data-source={source} aria-label={`Source: ${children}`}>{children}</span>;
                }
                return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        ) : <span className={styles.thinking}>Reading your analysis…</span>}
      </div>
    </article>
  );
}
