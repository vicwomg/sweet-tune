package com.sweettune.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final long SCREEN_TIMEOUT_MS = 3 * 60 * 1000L; // 3 minutes
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable clearScreenOnRunnable = () ->
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    private void resetScreenTimeout() {
        runOnUiThread(() -> {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            handler.removeCallbacks(clearScreenOnRunnable);
            handler.postDelayed(clearScreenOnRunnable, SCREEN_TIMEOUT_MS);
        });
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void keepScreenAwake() {
                    resetScreenTimeout();
                }
            }, "SweetTuneNative");
        }
        resetScreenTimeout();
    }

    @Override
    public void onResume() {
        super.onResume();
        resetScreenTimeout();
    }

    @Override
    public void onPause() {
        super.onPause();
        handler.removeCallbacks(clearScreenOnRunnable);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        resetScreenTimeout();
        return super.dispatchTouchEvent(ev);
    }
}
