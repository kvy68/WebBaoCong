package com.tbt.baocong.webadmin;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends Activity {

    private static final String PREFS_NAME = "tbt_webadmin_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_SHOW_BAR = "show_native_bar";
    private static final String DEFAULT_SERVER_URL = "http://127.0.0.1:3000";
    private static final int FILE_CHOOSER_RESULT_CODE = 1001;

    private WebView webView;
    private ProgressBar progressBar;
    private LinearLayout topBar;
    private TextView statusDot;
    private TextView hostLabel;
    private TextView floatingShowBtn;
    private ValueCallback<Uri[]> filePathCallback;
    private SharedPreferences prefs;
    private long lastBackPressTime = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.parseColor("#0F172A"));
            window.setNavigationBarColor(Color.parseColor("#0F172A"));
        }

        // Root container
        FrameLayout rootFrame = new FrameLayout(this);
        rootFrame.setBackgroundColor(Color.parseColor("#0B0F19"));

        LinearLayout mainColumn = new LinearLayout(this);
        mainColumn.setOrientation(LinearLayout.VERTICAL);
        mainColumn.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 1. Native Webmaster Control Bar
        topBar = buildNativeTopBar();
        mainColumn.addView(topBar);

        // 2. Thin loading progress bar
        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3)
        ));
        progressBar.setMax(100);
        progressBar.setVisibility(View.GONE);
        mainColumn.addView(progressBar);

        // 3. Main WebView
        webView = new WebView(this);
        webView.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1.0f
        ));
        webView.setBackgroundColor(Color.parseColor("#0B0F19"));
        mainColumn.addView(webView);

        rootFrame.addView(mainColumn);

        // Floating mini button when top bar is hidden
        floatingShowBtn = new TextView(this);
        floatingShowBtn.setText("🛡️");
        floatingShowBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        floatingShowBtn.setGravity(Gravity.CENTER);
        GradientDrawable fabBg = new GradientDrawable();
        fabBg.setColor(Color.parseColor("#CC4F46E5"));
        fabBg.setCornerRadius(dp(20));
        fabBg.setStroke(dp(1), Color.parseColor("#818CF8"));
        floatingShowBtn.setBackground(fabBg);
        FrameLayout.LayoutParams fabLp = new FrameLayout.LayoutParams(dp(38), dp(38));
        fabLp.gravity = Gravity.TOP | Gravity.END;
        fabLp.topMargin = dp(10);
        fabLp.rightMargin = dp(10);
        floatingShowBtn.setLayoutParams(fabLp);
        floatingShowBtn.setVisibility(prefs.getBoolean(KEY_SHOW_BAR, true) ? View.GONE : View.VISIBLE);
        topBar.setVisibility(prefs.getBoolean(KEY_SHOW_BAR, true) ? View.VISIBLE : View.GONE);
        floatingShowBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                setNativeBarVisible(true);
            }
        });
        rootFrame.addView(floatingShowBtn);

        setContentView(rootFrame);

        configureWebView();
        updateHostBadge();
        loadPortalPath("/admin");
    }

    private LinearLayout buildNativeTopBar() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0F172A"));
        bar.setPadding(dp(10), dp(6), dp(10), dp(6));
        bar.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        ));

        // Left: Brand + Status dot + Hostname (tap to open server config)
        LinearLayout brandBox = new LinearLayout(this);
        brandBox.setOrientation(LinearLayout.HORIZONTAL);
        brandBox.setGravity(Gravity.CENTER_VERTICAL);
        brandBox.setPadding(dp(6), dp(4), dp(8), dp(4));
        GradientDrawable brandBg = new GradientDrawable();
        brandBg.setColor(Color.parseColor("#1E293B"));
        brandBg.setCornerRadius(dp(8));
        brandBg.setStroke(dp(1), Color.parseColor("#334155"));
        brandBox.setBackground(brandBg);
        brandBox.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showServerConfigDialog();
            }
        });

        statusDot = new TextView(this);
        statusDot.setText("● ");
        statusDot.setTextColor(Color.parseColor("#10B981"));
        statusDot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        brandBox.addView(statusDot);

        hostLabel = new TextView(this);
        hostLabel.setText("🛡️ Webmaster");
        hostLabel.setTextColor(Color.parseColor("#F8FAFC"));
        hostLabel.setTypeface(Typeface.DEFAULT_BOLD);
        hostLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        brandBox.addView(hostLabel);

        bar.addView(brandBox);

        // Right: Horizontal scrollable quick actions
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.0f
        );
        scrollLp.leftMargin = dp(8);
        scroll.setLayoutParams(scrollLp);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);

        actions.addView(makeActionChip("📊 Tổng quan", "#4F46E5", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadPortalPath("/admin#/admin/overview");
            }
        }));

        actions.addView(makeActionChip("👥 Tài khoản", "#1E293B", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadPortalPath("/admin#/admin/users");
            }
        }));

        actions.addView(makeActionChip("🏠 Chấm công", "#1E293B", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadPortalPath("/#/");
            }
        }));

        actions.addView(makeActionChip("🔄", "#1E293B", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (webView != null) {
                    String url = webView.getUrl();
                    if (url == null || url.startsWith("data:")) {
                        loadPortalPath("/admin");
                    } else {
                        webView.reload();
                    }
                }
            }
        }));

        actions.addView(makeActionChip("⚙️", "#1E293B", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showServerConfigDialog();
            }
        }));

        scroll.addView(actions);
        bar.addView(scroll);

        return bar;
    }

    private TextView makeActionChip(String text, String bgHex, View.OnClickListener listener) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#F1F5F9"));
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
        tv.setTypeface(Typeface.DEFAULT_BOLD);
        tv.setPadding(dp(9), dp(5), dp(9), dp(5));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(bgHex));
        bg.setCornerRadius(dp(7));
        bg.setStroke(dp(1), Color.parseColor("#334155"));
        tv.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        lp.leftMargin = dp(5);
        tv.setLayoutParams(lp);
        tv.setOnClickListener(listener);
        return tv;
    }

    private void setNativeBarVisible(boolean visible) {
        prefs.edit().putBoolean(KEY_SHOW_BAR, visible).apply();
        topBar.setVisibility(visible ? View.VISIBLE : View.GONE);
        floatingShowBtn.setVisibility(visible ? View.GONE : View.VISIBLE);
        if (!visible) {
            Toast.makeText(this, "Đã ẩn thanh công cụ. Bấm nút 🛡️ ở góc phải trên để hiện lại.", Toast.LENGTH_SHORT).show();
        }
    }

    private String getServerBaseUrl() {
        String raw = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL);
        if (raw == null || raw.trim().isEmpty()) return DEFAULT_SERVER_URL;
        raw = raw.trim();
        while (raw.endsWith("/")) {
            raw = raw.substring(0, raw.length() - 1);
        }
        return raw;
    }

    private void updateHostBadge() {
        String base = getServerBaseUrl();
        String shortHost = base.replaceFirst("^https?://", "");
        if (shortHost.length() > 18) {
            shortHost = shortHost.substring(0, 16) + "…";
        }
        hostLabel.setText("🛡️ " + shortHost);
    }

    private void loadPortalPath(String path) {
        String base = getServerBaseUrl();
        String target = base + (path.startsWith("/") ? path : ("/" + path));
        webView.loadUrl(target);
    }

    private void configureWebView() {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setLoadsImagesAutomatically(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setSupportZoom(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);
        ws.setGeolocationEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }
        ws.setUserAgentString(ws.getUserAgentString() + " TBTWebAdminAPK/2.0.0");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(webView, true);
        }

        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleCustomUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    return handleCustomUrl(request.getUrl().toString());
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    CookieManager.getInstance().flush();
                }
                if (url != null && !url.startsWith("data:")) {
                    statusDot.setTextColor(Color.parseColor("#10B981"));
                }
                // Inject blob/data download bridge for client-side PNG/XLS exports
                injectDownloadHelper();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && (failingUrl.equals(view.getUrl()) || failingUrl.endsWith("/admin"))) {
                    showOfflineErrorPage(failingUrl, description);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                    showOfflineErrorPage(request.getUrl().toString(), error.getDescription().toString());
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(Intent.createChooser(intent, "Chọn tệp (.db hoặc ảnh)"), FILE_CHOOSER_RESULT_CODE);
                } catch (Exception e) {
                    MainActivity.this.filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Không thể mở trình chọn tệp", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("🛡️ TBT Quản Trị Web")
                        .setMessage(message)
                        .setPositiveButton("Đóng", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                result.confirm();
                            }
                        })
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("🛡️ Xác nhận thao tác")
                        .setMessage(message)
                        .setPositiveButton("Đồng ý", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                result.confirm();
                            }
                        })
                        .setNegativeButton("Hủy", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                result.cancel();
                            }
                        })
                        .setCancelable(false)
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, final JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                input.setText(defaultValue != null ? defaultValue : "");
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle(message)
                        .setView(input)
                        .setPositiveButton("OK", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                result.confirm(input.getText().toString());
                            }
                        })
                        .setNegativeButton("Hủy", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                result.cancel();
                            }
                        })
                        .setCancelable(false)
                        .show();
                return true;
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    return;
                }
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) {
                        req.addRequestHeader("Cookie", cookies);
                    }
                    req.addRequestHeader("User-Agent", userAgent);
                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    req.setTitle(fileName);
                    req.setDescription("Đang tải tệp từ TBT Quản Trị Web…");
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(req);
                        Toast.makeText(MainActivity.this, "📥 Đang tải về thư mục Download: " + fileName, Toast.LENGTH_LONG).show();
                    }
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    private boolean handleCustomUrl(String url) {
        if (url == null) return false;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            return false;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
        } catch (Exception ignored) {
        }
        return true;
    }

    private void injectDownloadHelper() {
        String js = "(function(){"
                + "if(window.__tbtApkHooked)return;window.__tbtApkHooked=true;"
                + "document.addEventListener('click',function(e){"
                + "var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
                + "if(!a||!a.href)return;"
                + "if(a.href.indexOf('blob:')===0){"
                + "e.preventDefault();"
                + "var fn=a.getAttribute('download')||'tbt-export.dat';"
                + "fetch(a.href).then(function(r){return r.blob();}).then(function(b){"
                + "var rd=new FileReader();"
                + "rd.onloadend=function(){if(window.AndroidBridge)window.AndroidBridge.saveBase64File(rd.result,fn,b.type||'application/octet-stream');};"
                + "rd.readAsDataURL(b);"
                + "});"
                + "}"
                + "},true);"
                + "})();";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(js, null);
        } else {
            webView.loadUrl("javascript:" + js);
        }
    }

    private void showOfflineErrorPage(String failingUrl, String reason) {
        statusDot.setTextColor(Color.parseColor("#EF4444"));
        String base = getServerBaseUrl();
        String html = "<!DOCTYPE html><html lang='vi'><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>"
                + "body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#0b0f19;color:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:88vh}"
                + ".card{max-width:440px;width:100%;background:#111827;border:1px solid #1e293b;border-radius:18px;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,.45)}"
                + ".badge{display:inline-block;padding:5px 12px;border-radius:99px;background:rgba(239,68,68,.15);color:#f87171;font-size:12px;font-weight:700;margin-bottom:12px}"
                + "h2{margin:0 0 8px;font-size:20px}"
                + "p{color:#94a3b8;font-size:14px;line-height:1.5;margin:0 0 14px}"
                + ".code{background:#090d16;border:1px solid #1e293b;padding:10px 12px;border-radius:10px;font-family:monospace;font-size:12.5px;color:#a5b4fc;margin-bottom:16px;word-break:break-all}"
                + "button{width:100%;padding:13px;border-radius:12px;border:0;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px}"
                + ".pri{background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff}"
                + ".sec{background:#1e293b;color:#e2e8f0;border:1px solid #334155}"
                + "</style></head><body><div class='card'>"
                + "<div class='badge'>● MẤT KẾT NỐI MÁY CHỦ</div>"
                + "<h2>🛡️ TBT Quản Trị Web</h2>"
                + "<p>Chưa kết nối được tới máy chủ Webmaster tại địa chỉ:</p>"
                + "<div class='code'>" + base + " (" + (reason != null ? reason : "ERR_CONNECTION_REFUSED") + ")</div>"
                + "<p>💡 Nếu máy chủ chạy trên Termux của máy này, hãy đảm bảo lệnh <b>node server.js</b> đang bật. Nếu chạy qua mạng Wi-Fi/LAN hoặc tên miền riêng, hãy bấm đổi địa chỉ máy chủ bên dưới.</p>"
                + "<button class='pri' onclick='AndroidBridge.retryConnection()'>🔄 Thử kết nối lại ngay</button>"
                + "<button class='sec' onclick='AndroidBridge.openServerConfig()'>⚙️ Đổi địa chỉ Máy chủ (IP / Domain)</button>"
                + "</div></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void showServerConfigDialog() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(14), dp(20), dp(6));

        TextView hint = new TextView(this);
        hint.setText("Nhập địa chỉ Máy chủ TBT Báo Công (ví dụ http://127.0.0.1:3000 khi chạy cùng máy Termux, hoặc IP LAN http://192.168.1.x:3000 / tên miền https://...):");
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        box.addView(hint);

        final EditText urlInput = new EditText(this);
        urlInput.setSingleLine(true);
        urlInput.setText(getServerBaseUrl());
        urlInput.setSelection(urlInput.getText().length());
        box.addView(urlInput);

        LinearLayout quickRow = new LinearLayout(this);
        quickRow.setOrientation(LinearLayout.HORIZONTAL);
        quickRow.setPadding(0, dp(8), 0, dp(4));

        TextView btnLocal = makeActionChip("📱 Local (127.0.0.1:3000)", "#334155", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                urlInput.setText("http://127.0.0.1:3000");
            }
        });
        quickRow.addView(btnLocal);

        boolean currentlyVisible = prefs.getBoolean(KEY_SHOW_BAR, true);
        TextView btnToggleBar = makeActionChip(currentlyVisible ? "👁 Ẩn thanh trên" : "👁 Hiện thanh trên", "#334155", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                setNativeBarVisible(!prefs.getBoolean(KEY_SHOW_BAR, true));
            }
        });
        quickRow.addView(btnToggleBar);

        box.addView(quickRow);

        new AlertDialog.Builder(this)
                .setTitle("⚙️ Cấu hình Máy chủ Webmaster")
                .setView(box)
                .setPositiveButton("Lưu & Kết nối", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String val = urlInput.getText().toString().trim();
                        if (val.isEmpty()) val = DEFAULT_SERVER_URL;
                        if (!val.startsWith("http://") && !val.startsWith("https://")) {
                            val = "http://" + val;
                        }
                        while (val.endsWith("/")) {
                            val = val.substring(0, val.length() - 1);
                        }
                        prefs.edit().putString(KEY_SERVER_URL, val).apply();
                        updateHostBadge();
                        loadPortalPath("/admin");
                        Toast.makeText(MainActivity.this, "Đã chuyển máy chủ sang: " + val, Toast.LENGTH_SHORT).show();
                    }
                })
                .setNeutralButton("Xóa Cache", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        webView.clearCache(true);
                        loadPortalPath("/admin");
                        Toast.makeText(MainActivity.this, "Đã làm mới bộ nhớ đệm", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void retryConnection() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    loadPortalPath("/admin");
                }
            });
        }

        @JavascriptInterface
        public void openServerConfig() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showServerConfigDialog();
                }
            });
        }

        @JavascriptInterface
        public void saveBase64File(final String dataUrl, final String fileName, final String mimeType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        int comma = dataUrl.indexOf(',');
                        String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
                        byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (!dir.exists()) dir.mkdirs();
                        String cleanName = fileName.replaceAll("[^a-zA-Z0-9._-]", "_");
                        File out = new File(dir, cleanName);
                        try (FileOutputStream fos = new FileOutputStream(out)) {
                            fos.write(bytes);
                        }
                        Toast.makeText(MainActivity.this, "✅ Đã lưu tệp vào Download/" + cleanName, Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Lỗi lưu tệp: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null) {
                String dataString = data.getDataString();
                if (dataString != null) {
                    results = new Uri[]{Uri.parse(dataString)};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            long now = System.currentTimeMillis();
            if (now - lastBackPressTime > 2000) {
                lastBackPressTime = now;
                Toast.makeText(this, "Bấm Quay lại lần nữa để thoát TBT Quản Trị Web", Toast.LENGTH_SHORT).show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    private int dp(int value) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                value,
                getResources().getDisplayMetrics()
        );
    }
}
