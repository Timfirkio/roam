package com.roam.exploration;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

/** Append-only ride fixes, shared by the foreground service and Capacitor plugin. */
final class RidePointStore extends SQLiteOpenHelper {
  private static final String DATABASE = "ride_points.db";
  private static final int DRAIN_BATCH_POINTS = 1000;
  private static final Object LOCK = new Object();
  private static RidePointStore instance;
  private final Context context;

  static RidePointStore get(Context context) {
    synchronized (LOCK) {
      if (instance == null) instance = new RidePointStore(context);
      return instance;
    }
  }

  private RidePointStore(Context context) {
    super(context, DATABASE, null, 1);
    this.context = context.getApplicationContext();
  }

  @Override public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE fixes (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)");
    db.execSQL("CREATE INDEX pending_fixes ON fixes (delivered, id)");
  }

  @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    throw new IllegalStateException("Unsupported ride point database version");
  }

  private SQLiteDatabase database() {
    SQLiteDatabase db = getWritableDatabase();
    SharedPreferences preferences = context.getSharedPreferences("ride_tracking", Context.MODE_PRIVATE);
    if (!preferences.contains("route") && !preferences.contains("points")) return db;
    if (android.database.DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM fixes", null) > 0) {
      // Migration committed before a process death, but preference cleanup did not.
      preferences.edit().remove("route").remove("points").apply();
      return db;
    }
    db.beginTransaction();
    try {
      JSONArray route = new JSONArray(preferences.getString("route", "[]"));
      JSONArray pending = new JSONArray(preferences.getString("points", "[]"));
      // The old queue was the tail of the complete route. Match by timestamp
      // so an upgrade during an active ride can still deliver those fixes.
      java.util.HashSet<Long> pendingTimestamps = new java.util.HashSet<>();
      for (int i = 0; i < pending.length(); i++) pendingTimestamps.add(pending.getJSONObject(i).optLong("timestamp"));
      if (route.length() == 0) route = pending;
      for (int i = 0; i < route.length(); i++) {
        JSONObject point = route.getJSONObject(i);
        insert(db, point, pendingTimestamps.contains(point.optLong("timestamp")) ? 0 : 1);
      }
      db.setTransactionSuccessful();
    } catch (Exception error) {
      throw new IllegalStateException("Could not migrate recorded ride", error);
    } finally {
      db.endTransaction();
    }
    preferences.edit().remove("route").remove("points").apply();
    return db;
  }

  private static long insert(SQLiteDatabase db, JSONObject point, int delivered) {
    ContentValues values = new ContentValues();
    values.put("payload", point.toString());
    values.put("delivered", delivered);
    return db.insertOrThrow("fixes", null, values);
  }

  void reset() {
    synchronized (LOCK) {
      SQLiteDatabase db = database();
      db.delete("fixes", null, null);
    }
  }

  void append(JSONObject point) {
    synchronized (LOCK) {
      SQLiteDatabase db = database();
      insert(db, point, 0);
    }
  }

  JSONArray drain() throws Exception {
    synchronized (LOCK) {
      SQLiteDatabase db = database();
      JSONArray result = new JSONArray();
      db.beginTransaction();
      try {
        long lastDeliveredId = -1;
        try (Cursor cursor = db.rawQuery("SELECT id, payload FROM fixes WHERE delivered = 0 ORDER BY id LIMIT ?", new String[] { String.valueOf(DRAIN_BATCH_POINTS) })) {
          while (cursor.moveToNext()) {
            lastDeliveredId = cursor.getLong(0);
            result.put(new JSONObject(cursor.getString(1)));
          }
        }
        if (lastDeliveredId >= 0) db.execSQL("UPDATE fixes SET delivered = 1 WHERE delivered = 0 AND id <= ?", new Object[] { lastDeliveredId });
        db.setTransactionSuccessful();
      } finally {
        db.endTransaction();
      }
      return result;
    }
  }

  JSONArray route() throws Exception {
    synchronized (LOCK) {
      SQLiteDatabase db = database();
      JSONArray result = new JSONArray();
      try (Cursor cursor = db.rawQuery("SELECT payload FROM fixes ORDER BY id", null)) {
        while (cursor.moveToNext()) result.put(new JSONObject(cursor.getString(0)));
      }
      return result;
    }
  }
}
