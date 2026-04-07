export interface SubSkillNode {
  title: string;
  level: number;
  summary: string;
  children: SubSkillNode[];
  bulletPoints: string[];
}

export interface SkillTreeResult {
  source: 'declared' | 'auto';
  tree: SubSkillNode[];
}

export function parseSkillTree(content: string): SkillTreeResult {
  const declared = parseDeclaredSubSkills(content);
  if (declared.length > 0) {
    return { source: 'declared', tree: declared };
  }
  return { source: 'auto', tree: parseFromHeaders(content) };
}

interface DeclaredSubSkill {
  title?: string;
  description?: string;
  children?: DeclaredSubSkill[];
}

function parseDeclaredSubSkills(content: string): SubSkillNode[] {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return [];

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return [];

  const frontmatter = lines.slice(1, endIdx).join('\n');

  const subSkillsMatch = frontmatter.match(/^sub_skills:\s*$/m);
  if (!subSkillsMatch) return [];

  const startLine = frontmatter.slice(subSkillsMatch.index! + subSkillsMatch[0].length);
  const yamlItems = parseYamlList(startLine, 2);

  return yamlItems.map(item => convertDeclared(item, 2));
}

function parseYamlList(text: string, baseIndent: number): DeclaredSubSkill[] {
  const lines = text.split('\n');
  const items: DeclaredSubSkill[] = [];
  let current: DeclaredSubSkill | null = null;
  let childrenText = '';
  let collectingChildren = false;
  let childBaseIndent = 0;

  for (const line of lines) {
    const stripped = line.trimEnd();
    if (stripped.length === 0) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = stripped.trim();

    if (indent < baseIndent && trimmed.length > 0 && !trimmed.startsWith('-')) {
      break;
    }

    if (indent === baseIndent && trimmed.startsWith('- ')) {
      if (current) {
        if (collectingChildren && childrenText.trim()) {
          current.children = parseYamlList(childrenText, childBaseIndent);
        }
        items.push(current);
      }
      current = {};
      collectingChildren = false;
      childrenText = '';

      const kvMatch = trimmed.slice(2).match(/^(\w+):\s*(.+)/);
      if (kvMatch) {
        (current as Record<string, string>)[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
      }
      continue;
    }

    if (current && indent > baseIndent) {
      if (trimmed.startsWith('children:')) {
        collectingChildren = true;
        childBaseIndent = indent + 2;
        childrenText = '';
        continue;
      }

      if (collectingChildren) {
        childrenText += line + '\n';
        continue;
      }

      const kvMatch = trimmed.match(/^(\w+):\s*(.+)/);
      if (kvMatch) {
        (current as Record<string, string>)[kvMatch[1]] = kvMatch[2].replace(/^["']|["']$/g, '');
      }
    }
  }

  if (current) {
    if (collectingChildren && childrenText.trim()) {
      current.children = parseYamlList(childrenText, childBaseIndent);
    }
    items.push(current);
  }

  return items;
}

function convertDeclared(item: DeclaredSubSkill, level: number): SubSkillNode {
  return {
    title: item.title || '未命名',
    level,
    summary: item.description || '',
    children: (item.children || []).map(c => convertDeclared(c, level + 1)),
    bulletPoints: [],
  };
}

function parseFromHeaders(content: string): SubSkillNode[] {
  const lines = content.split('\n');
  const root: SubSkillNode[] = [];
  const stack: { node: SubSkillNode; level: number }[] = [];

  let inCodeBlock = false;
  let currentBullets: string[] = [];
  let summaryLines: string[] = [];

  const frontmatterEnd = findFrontmatterEnd(lines);

  for (let i = frontmatterEnd; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const headerMatch = line.match(/^(#{1,4})\s+(.+)/);

    if (headerMatch) {
      flushBullets(stack, currentBullets, summaryLines);
      currentBullets = [];
      summaryLines = [];

      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();

      if (level === 1) continue;

      const node: SubSkillNode = {
        title,
        level,
        summary: '',
        children: [],
        bulletPoints: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      } else {
        root.push(node);
      }

      stack.push({ node, level });
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+/);
    if (bulletMatch && stack.length > 0) {
      const text = line.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim();
      if (text.length > 0 && text.length < 120) {
        currentBullets.push(text);
      }
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length > 0 && stack.length > 0 && summaryLines.length < 2) {
      if (!trimmed.startsWith('|') && !trimmed.startsWith('>') && !trimmed.startsWith('<')) {
        summaryLines.push(trimmed);
      }
    }
  }

  flushBullets(stack, currentBullets, summaryLines);
  return root;
}

function flushBullets(
  stack: { node: SubSkillNode; level: number }[],
  bullets: string[],
  summaryLines: string[]
) {
  if (stack.length === 0) return;
  const current = stack[stack.length - 1].node;
  if (bullets.length > 0) {
    current.bulletPoints.push(...bullets.slice(0, 8));
  }
  if (!current.summary && summaryLines.length > 0) {
    current.summary = summaryLines.join(' ').slice(0, 200);
  }
}

function findFrontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}
