import { htmlToPlainText, safeHref, sanitizeHtml } from './html-sanitizer.js';

describe('sanitizeHtml', () => {
  it('giữ các thẻ định dạng cho phép', () => {
    const html =
      '<h2>Tiêu đề</h2><p>Chào <strong>cả</strong> <em>nhà</em> <u>u</u> <s>s</s><br></p>' +
      '<ul><li>Một</li></ul><ol><li>Hai</li></ol><blockquote>Trích</blockquote><h3>Nhỏ</h3>';
    expect(sanitizeHtml(html)).toBe(html);
  });

  it('bỏ script cùng nội dung của nó', () => {
    expect(sanitizeHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    expect(sanitizeHtml('<SCRIPT >alert(1)</SCRIPT >x')).toBe('x');
    expect(sanitizeHtml('x<script>không đóng')).toBe('x');
  });

  it('bỏ style, iframe, object, svg cùng nội dung', () => {
    const out = sanitizeHtml('<style>p{}</style><iframe src="x">y</iframe><svg onload="a()"><g/></svg><p>ok</p>');
    expect(out).toBe('<p>ok</p>');
  });

  it('bỏ mọi thuộc tính on*, style, class', () => {
    expect(sanitizeHtml('<p onclick="x()" style="color:red" class="c" id="i">a</p>')).toBe('<p>a</p>');
    expect(sanitizeHtml('<strong onmouseover=alert(1)>a</strong>')).toBe('<strong>a</strong>');
  });

  it('không cho img ở P1, kể cả có src hợp lệ', () => {
    expect(sanitizeHtml('<p>a<img src="https://x.vn/a.png" onerror="x()">b</p>')).toBe('<p>ab</p>');
  });

  it('chặn javascript: URL kể cả khi che giấu', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href=" JaVaScRiPt:alert(1)">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="jav&#x09;ascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="java\nscript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="data:text/html,<script>1</script>">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="vbscript:x">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="//evil.com/x">x</a>')).toBe('x');
    expect(sanitizeHtml('<a href="/tuong-doi">x</a>')).toBe('x');
  });

  it('cho liên kết http, https, mailto và gắn rel, target', () => {
    expect(sanitizeHtml('<a href="https://svn.vn/a?b=1&c=2" onclick="x">Xem</a>')).toBe(
      '<a href="https://svn.vn/a?b=1&amp;c=2" rel="noopener noreferrer nofollow" target="_blank">Xem</a>',
    );
    expect(sanitizeHtml('<a href="http://svn.vn" target="_self" rel="opener">a</a>')).toContain(
      'rel="noopener noreferrer nofollow" target="_blank"',
    );
    expect(sanitizeHtml('<a href="mailto:a@svn.vn">mail</a>')).toContain('href="mailto:a@svn.vn"');
  });

  it('escape dấu nháy trong href, không để thoát khỏi thuộc tính', () => {
    const out = sanitizeHtml(`<a href='https://svn.vn/"onmouseover="x()'>a</a>`);
    // Dấu nháy bị mã hoá trong URL, nên không tạo được thuộc tính mới.
    expect(out).toBe(
      '<a href="https://svn.vn/%22onmouseover=%22x()" rel="noopener noreferrer nofollow" target="_blank">a</a>',
    );
  });

  it('bỏ chú thích, doctype, CDATA', () => {
    expect(sanitizeHtml('a<!-- <script>x</script> -->b<!DOCTYPE html>c<![CDATA[d]]>e')).toBe('abce');
  });

  it('cân lại thẻ và bỏ thẻ đóng thừa', () => {
    expect(sanitizeHtml('<p><strong>a</p>')).toBe('<p><strong>a</strong></p>');
    expect(sanitizeHtml('a</p></strong>b')).toBe('ab');
    expect(sanitizeHtml('<ul><li>a')).toBe('<ul><li>a</li></ul>');
  });

  it('escape chữ lẻ', () => {
    expect(sanitizeHtml('1 < 2 && 3 > 2')).toBe('1 &lt; 2 &amp;&amp; 3 &gt; 2');
    expect(sanitizeHtml('a &amp; b &copy; c')).toBe('a &amp; b &copy; c');
  });

  it('thẻ lạ bị bỏ nhưng giữ chữ', () => {
    expect(sanitizeHtml('<div><font color="red">a</font><marquee>b</marquee></div>')).toBe('ab');
  });

  it('không vỡ với thẻ dở dang hay thuộc tính bẩn', () => {
    expect(() => sanitizeHtml('<p <a href="x')).not.toThrow();
    expect(sanitizeHtml('<p "onclick=x>a</p>')).not.toMatch(/onclick/);
    expect(sanitizeHtml('<scr\u0000ipt>alert(1)</scr\u0000ipt>')).not.toMatch(/<script/i);
  });
});

describe('safeHref', () => {
  it('chỉ nhận URL tuyệt đối an toàn', () => {
    expect(safeHref('https://a.vn')).toBe('https://a.vn/');
    expect(safeHref('javascript:1')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref('https://')).toBeUndefined();
  });
});

describe('htmlToPlainText', () => {
  it('lấy chữ thuần và nhận ra nội dung rỗng', () => {
    expect(htmlToPlainText('<p>Chào <strong>bạn</strong></p>')).toBe('Chào bạn');
    expect(htmlToPlainText('<p><br></p>')).toBe('');
    expect(htmlToPlainText('<p>&nbsp;</p>')).toBe('');
  });
});
