import nunjucks from 'nunjucks';
import type { MessageRecord, SessionSummary } from '../domain/message-store.js';
import { formatTime } from './format.js';

const BASE_TEMPLATE = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>{{ title }}</title>
  <style type="text/css">
    body { margin: 4px; color: #111; background: #fff; font-family: sans-serif; }
    h1 { font-size: 18px; }
    h2 { font-size: 16px; }
    h3 { font-size: 14px; }
    .nav { border-bottom: 1px solid #999; padding-bottom: 4px; margin-bottom: 6px; }
    .nav a { margin-right: 8px; }
    .status { margin: 4px 0; padding: 4px; border: 1px solid #777; background: #eee; }
    .status.ok { background: #dfd; }
    .status.err { background: #fdd; }
    .box { margin: 6px 0; padding: 5px; border: 1px solid #777; }
    table.list { border-collapse: collapse; }
    table.list td, table.list th { border: 1px solid #999; padding: 3px; text-align: left; }
    .meta { color: #555; }
    .err { color: #900; }
    .flash { margin: 4px 0; padding: 4px; border: 1px solid #999; }
    .flash.ok { background: #dfd; }
    .flash.err { background: #fdd; }
    textarea { width: 98%; }
  </style>
</head>
<body>
  <h1>{{ title }}</h1>
  <p class="nav"><a href="/">首页</a> <a href="/healthz">健康检查</a> <a href="/logout">退出</a></p>
  {% if status %}
    <div class="status {% if status == 'connected' %}ok{% else %}err{% endif %}">连接状态：{{ status }}</div>
  {% endif %}
  {% for f in flashes %}<div class="flash {{ f.kind }}">{{ f.message }}</div>{% endfor %}
  {% block content %}{% endblock %}
</body>
</html>`;

const INDEX_TEMPLATE = `{% extends "base.html" %}
{% block content %}
  <h2>会话列表</h2>
  <p class="meta"><a href="/refresh">刷新好友/群列表</a></p>
  {% if sessions.length == 0 %}
    <p>暂无会话。连接 OneBot 后收到的消息会显示在这里。</p>
  {% else %}
    <table class="list">
      <tr><th>类型</th><th>名称</th><th>最近消息</th><th>时间</th></tr>
      {% for s in sessions %}
        <tr>
          <td>{{ s.typeLabel }}</td>
          <td><a href="/chat/{{ s.type }}/{{ s.peerId }}">{{ s.name }}</a></td>
          <td>{{ s.lastPreview }}</td>
          <td>{{ s.lastTime | time }}</td>
        </tr>
      {% endfor %}
    </table>
  {% endif %}
  <h2>好友 / 群</h2>
  {% if friends.length == 0 and groups.length == 0 %}
    <p>尚未获取到好友或群列表。</p>
  {% endif %}
  {% if friends.length > 0 %}
    <h3>好友</h3>
    <ul>
      {% for f in friends %}<li><a href="/chat/private/{{ f.user_id }}">{{ f.nickname }}</a></li>{% endfor %}
    </ul>
  {% endif %}
  {% if groups.length > 0 %}
    <h3>群聊</h3>
    <ul>
      {% for g in groups %}<li><a href="/chat/group/{{ g.group_id }}">{{ g.group_name }}</a></li>{% endfor %}
    </ul>
  {% endif %}
{% endblock %}`;

const CHAT_TEMPLATE = `{% extends "base.html" %}
{% block content %}
  <h2>{{ chatTitle }}</h2>
  <p class="meta"><a href="{{ chatPath }}">刷新消息</a></p>
  {% if messages.length == 0 %}
    <p>暂无消息。本次服务运行期间收到的消息会显示在这里；OneBot 标准接口无法可靠拉取历史消息。</p>
  {% else %}
    <p class="meta">显示最近 {{ messages.length }} 条消息（最多 {{ maxMessages }} 条）。</p>
    {% for m in messages %}
      <div class="box">
        <strong>{{ m.senderName }}</strong>
        <span class="meta">[{{ m.typeLabel }}] {{ m.time | time }}</span>
        <br>{{ m.text }}
      </div>
    {% endfor %}
  {% endif %}
  <p class="meta"><a href="{{ chatPath }}">刷新消息</a></p>
  <div class="box">
    <form action="{{ formAction }}" method="post">
      <p>发送消息（{{ chatTitle }}）：</p>
      <p><textarea name="message" rows="3"></textarea></p>
      {% if isGroup %}<p class="meta">提示：可在消息中输入 @QQ号 提到某人（如 @123456 你好）。</p>{% endif %}
      <input type="hidden" name="_csrf" value="{{ csrf }}">
      <p><input type="submit" value="发送"></p>
    </form>
  </div>
  <p class="meta"><a href="/">返回会话列表</a></p>
{% endblock %}`;

const ERROR_TEMPLATE = `{% extends "base.html" %}
{% block content %}
  <h2>出错了</h2>
  <p class="err">{{ message }}</p>
  <p><a href="/">返回首页</a></p>
{% endblock %}`;

const LOGIN_TEMPLATE = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>{{ title }}</title>
  <style type="text/css">
    body { margin: 4px; color: #111; background: #fff; font-family: sans-serif; }
    h1 { font-size: 18px; }
    .box { margin: 6px 0; padding: 5px; border: 1px solid #777; }
    .flash { margin: 4px 0; padding: 4px; border: 1px solid #999; }
    .flash.err { background: #fdd; color: #900; }
    input[type="text"], input[type="password"] { width: 98%; }
  </style>
</head>
<body>
  <h1>{{ title }}</h1>
  {% for f in flashes %}<div class="flash {{ f.kind }}">{{ f.message }}</div>{% endfor %}
  <div class="box">
    <form action="/login" method="post">
      <p>账号：<input type="text" name="username"></p>
      <p>密码：<input type="password" name="password"></p>
      <input type="hidden" name="_csrf" value="{{ csrf }}">
      <p><input type="submit" value="登录"></p>
    </form>
  </div>
</body>
</html>`;

class StringLoader implements nunjucks.ILoader {
  getSource(name: string): nunjucks.LoaderSource {
    const src = sources[name];
    if (src === undefined) {
      throw new Error(`模板不存在: ${name}`);
    }
    return { src, path: name, noCache: true };
  }
}

const sources: Record<string, string> = {
  'base.html': BASE_TEMPLATE,
  'index.html': INDEX_TEMPLATE,
  'chat.html': CHAT_TEMPLATE,
  'error.html': ERROR_TEMPLATE,
  'login.html': LOGIN_TEMPLATE,
};

const env = new nunjucks.Environment(new StringLoader(), { autoescape: true });
env.addFilter('time', (v: number) => formatTime(v));

export interface Flash {
  kind: 'ok' | 'err';
  message: string;
}

export interface PageData {
  title: string;
  status: string;
  flashes: Flash[];
}

export interface IndexData extends PageData {
  sessions: Array<{
    sessionKey: string;
    type: string;
    peerId: number;
    name: string;
    typeLabel: string;
    lastPreview: string;
    lastTime: number;
  }>;
  friends: Array<{ user_id: number; nickname: string }>;
  groups: Array<{ group_id: number; group_name: string }>;
}

export interface ChatData extends PageData {
  chatTitle: string;
  typeLabel: string;
  chatPath: string;
  formAction: string;
  csrf: string;
  isGroup: boolean;
  maxMessages: number;
  messages: Array<{ senderName: string; typeLabel: string; time: number; text: string }>;
}

export interface ErrorData extends PageData {
  message: string;
}

export interface LoginData {
  title: string;
  flashes: Flash[];
  csrf: string;
}

export function renderIndex(data: IndexData): string {
  return env.render('index.html', data);
}

export function renderChat(data: ChatData): string {
  return env.render('chat.html', data);
}

export function renderError(data: ErrorData): string {
  return env.render('error.html', data);
}

export function renderLogin(data: LoginData): string {
  return env.render('login.html', data);
}

export function formatSessionForView(session: SessionSummary): IndexData['sessions'][number] {
  return {
    sessionKey: session.sessionKey,
    type: session.type,
    peerId: session.peerId,
    name: session.name,
    typeLabel: session.type === 'private' ? '私聊' : '群聊',
    lastPreview: truncate(session.lastMessage?.text ?? '', 40),
    lastTime: session.lastMessage?.time ?? 0,
  };
}

export function formatMessageForView(
  m: MessageRecord,
  typeLabel: string,
): ChatData['messages'][number] {
  return {
    senderName: m.senderName,
    typeLabel,
    time: m.time,
    text: m.text.length > 0 ? m.text : '[非文本消息]',
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
