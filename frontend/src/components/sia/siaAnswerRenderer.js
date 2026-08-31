import React from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

function splitTableRow(line) {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function getInlineContent(text, keyPrefix) {
  const parts = String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part.replaceAll("**", "");
  });
}

function isListItem(line) {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function getListItemContent(line) {
  return line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "");
}

function isOrderedListItem(line) {
  return /^\s*\d+[.)]\s+/.test(line);
}

// Helper components for new UI kinds
const ResponseCard = ({ title, content }) => (
  <Card variant="outlined" sx={{ mb: 2 }}>
    <CardContent>
      {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
      <Typography variant="body2">{content}</Typography>
    </CardContent>
  </Card>
);

const ComparisonTable = ({ data }) => (
    <table className="sia-comparison-table" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {Object.keys(data[0] || {}).map((col) => (
            <th key={col} style={{ borderBottom: "1px solid #ddd", padding: "4px" }}>{col}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={i}>
            {Object.entries(row).map(([col, val]) => (
              <td key={col} style={{ padding: "4px", textAlign: "center", backgroundColor: typeof val === 'number' && i === data.length - 1 ? (val > 0 ? '#e6ffed' : '#ffe6e6') : 'inherit' }}>{val}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
);

const TrendChart = ({ series, title }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={series}>
      {title && <text x={0} y={10} fill="#666">{title}</text>}
      <XAxis dataKey="x" />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey="y" stroke="#1976d2" dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

// Safely turns the limited Markdown SIA produces into React elements. It
// never interprets raw HTML, so provider text cannot execute in the page.
export function renderSiaAnswer(content) {
  // Try to parse JSON to get structured answer
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && parsed.kind) {
      switch (parsed.kind) {
        case 'card':
          return <ResponseCard title={parsed.title} content={parsed.body} />;
        case 'list':
          return (
            <ul className="sia-markdown-list" style={{ marginLeft: '1em' }}>
              {Array.isArray(parsed.items) ? parsed.items.map((it, idx) => (
                <li key={idx}>{it}</li>
              )) : null}
            </ul>
          );
        case 'comparison':
          return <ComparisonTable data={parsed.rows} />;
        case 'trend':
          return <TrendChart series={parsed.series} title={parsed.title} />;
        default:
          break;
      }
    }
  } catch (e) {
    // not JSON – continue to markdown rendering
  }
  // Existing markdown rendering fallback
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.trim() === "") { index += 1; continue; }
    if (line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="sia-markdown-table-wrap" key={`table-${index}`}>
          <table className="sia-markdown-table">
            <thead>
              <tr>{headers.map((header, cellIndex) => <th key={`header-${cellIndex}`}>{getInlineContent(header, `header-${cellIndex}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>{getInlineContent(row[cellIndex] || "", `cell-${rowIndex}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (isListItem(line)) {
      const ordered = isOrderedListItem(line);
      const items = [];
      while (index < lines.length && isListItem(lines[index]) && isOrderedListItem(lines[index]) === ordered) {
        items.push(getListItemContent(lines[index]));
        index += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag className="sia-markdown-list" key={`list-${index}`}>
          {items.map((item, itemIndex) => <li key={`item-${itemIndex}`}>{getInlineContent(item, `list-${itemIndex}`)}</li>)}
        </ListTag>
      );
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      blocks.push(<h3 className="sia-markdown-heading" key={`heading-${index}`}>{getInlineContent(heading[1], `heading-${index}`)}</h3>);
      index += 1; continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() !== "" && !isListItem(lines[index]) && !(lines[index].includes("|") && isTableSeparator(lines[index + 1])) && !/^#{1,3}\s+/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p className="sia-markdown-paragraph" key={`paragraph-${index}`}>{getInlineContent(paragraph.join(" "), `paragraph-${index}`)}</p>);
  }
  return blocks;
}
