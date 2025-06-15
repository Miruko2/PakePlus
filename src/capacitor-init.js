// capacitor-init.js - 在应用启动时执行的初始化脚本

(function() {
  // 检测是否在Capacitor/App环境中
  const isCapacitorEnv = typeof window !== 'undefined' && 
    (window.Capacitor || 
     window.navigator.userAgent.includes('capacitor') || 
     window.navigator.userAgent.includes('android') ||
     window.location.protocol === 'file:' ||
     /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
  
  if (!isCapacitorEnv) {
    console.log('📱 不是Capacitor环境，跳过初始化');
    return;
  }
  
  console.log('📱 Capacitor应用初始化脚本执行中...');
  console.log('📱 UA:', navigator.userAgent);
  console.log('📱 Protocol:', window.location.protocol);
  
  // 创建全局应用状态对象
  window.appState = {
    initialized: false,
    lastActive: Date.now(),
    sessionRestored: false,
    lastRefreshTime: 0
  };
  
  // 应用恢复会话功能
  async function restoreSession() {
    console.log('🔄 Capacitor - 尝试恢复会话...');
    
    try {
      // 检查localStorage中是否有会话数据
      const sessionKeys = [
        'sb-session',
        'sb-https-session',
        'sb-auth-token',
        'sb-https-auth-token'
      ];
      
      let hasSession = false;
      
      // 检查是否有任何会话数据
      for (const key of sessionKeys) {
        if (localStorage.getItem(key)) {
          console.log(`✅ 找到会话数据: ${key}`);
          hasSession = true;
          break;
        }
      }
      
      // 如果有会话数据，尝试恢复
      if (hasSession) {
        // 如果httpsDebug工具已加载，使用它的恢复功能
        if (window.httpsDebug && typeof window.httpsDebug.restore === 'function') {
          console.log('🛠️ 使用httpsDebug.restore()恢复会话');
          const success = await window.httpsDebug.restore();
          if (success) {
            console.log('✅ 会话恢复成功');
            window.appState.sessionRestored = true;
            // 保存最后刷新时间
            window.appState.lastRefreshTime = Date.now();
            // 触发会话恢复事件
            window.dispatchEvent(new Event('sessionrestored'));
            return true;
          }
        }
        
        // 如果supabase已加载，直接使用它的API
        if (window.supabase && window.supabase.auth) {
          console.log('🔑 使用supabase.auth.refreshSession()恢复会话');
          try {
            const { data, error } = await window.supabase.auth.refreshSession();
            if (!error && data.session) {
              console.log('✅ 会话刷新成功:', data.session.user.id);
              window.appState.sessionRestored = true;
              // 保存最后刷新时间
              window.appState.lastRefreshTime = Date.now();
              // 触发会话恢复事件
              window.dispatchEvent(new Event('sessionrestored'));
              return true;
            } else if (error) {
              console.warn('⚠️ 会话刷新失败:', error.message);
            }
          } catch (e) {
            console.error('💥 会话刷新异常:', e);
          }
        }
        
        console.warn('⚠️ 会话恢复失败，可能需要重新登录');
      } else {
        console.log('📋 没有找到会话数据，无需恢复');
      }
    } catch (e) {
      console.error('💥 恢复会话时出错:', e);
    }
    
    return false;
  }
  
  // 应用活动监控
  function setupActivityMonitoring() {
    // 记录应用最后活动时间
    const updateLastActive = () => {
      window.appState.lastActive = Date.now();
    };
    
    // 监听用户交互事件
    ['click', 'touchstart', 'scroll', 'keypress'].forEach(eventType => {
      document.addEventListener(eventType, updateLastActive, { passive: true });
    });
    
    console.log('👁️ 应用活动监控已设置');
  }
  
  // 防止会话初始化无限循环
  function setupInfiniteLoopProtection() {
    // 设置计数器以检测潜在的无限循环
    let sessionCheckCount = 0;
    
    // 代理supabase.auth.getSession方法以计数调用次数
    if (window.supabase && window.supabase.auth) {
      const originalGetSession = window.supabase.auth.getSession.bind(window.supabase.auth);
      window.supabase.auth.getSession = async function() {
        sessionCheckCount++;
        
        if (sessionCheckCount > 10) {
          console.warn('⚠️ 检测到潜在的无限循环，会话检查次数过多');
          // 重置计数器
          sessionCheckCount = 0;
          return { data: { session: null }, error: null };
        }
        
        return originalGetSession();
      };
      
      console.log('🔄 会话循环保护已设置');
    }
  }
  
  // 设置定期刷新机制
  function setupPeriodicRefresh() {
    // 设置定期刷新会话的间隔，避免会话过期
    const sessionRefreshInterval = setInterval(async () => {
      try {
        // 检查上次刷新时间，避免频繁刷新
        const now = Date.now();
        const timeSinceLastRefresh = now - (window.appState.lastRefreshTime || 0);
        
        // 如果距离上次刷新不到10分钟，跳过
        if (timeSinceLastRefresh < 600000) { // 10分钟 = 600000毫秒
          return;
        }
        
        console.log('⏰ Capacitor - 执行定期会话刷新');
        
        // 尝试刷新会话
        if (window.supabase && window.supabase.auth) {
          const { data, error } = await window.supabase.auth.refreshSession();
          if (!error && data.session) {
            console.log('✅ 定期会话刷新成功');
            window.appState.lastRefreshTime = now;
            
            // 触发刷新事件通知应用组件
            try {
              window.dispatchEvent(new Event('apprefresh'));
            } catch (e) {
              console.error('❌ 触发刷新事件失败:', e);
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ 定期刷新出错:', e);
      }
    }, 300000); // 每5分钟检查一次 (300000毫秒)
    
    // 监听应用可见性变化
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        console.log('👁️ 应用变为可见，尝试刷新会话和内容');
        
        // 检查是否需要刷新（距离上次刷新超过2分钟）
        const now = Date.now();
        const timeSinceLastRefresh = now - (window.appState.lastRefreshTime || 0);
        
        if (timeSinceLastRefresh > 120000) { // 2分钟 = 120000毫秒
          try {
            // 尝试刷新会话
            if (window.supabase && window.supabase.auth) {
              await window.supabase.auth.refreshSession();
              window.appState.lastRefreshTime = now;
              
              // 触发刷新事件
              window.dispatchEvent(new Event('appresume'));
              console.log('📣 应用恢复，已触发刷新事件');
            }
          } catch (e) {
            console.warn('⚠️ 可见性变化刷新出错:', e);
          }
        }
      }
    });
    
    // 返回清理函数
    return () => {
      clearInterval(sessionRefreshInterval);
    };
  }
  
  // 全局暴露应用函数
  window.capacitorApp = {
    restoreSession,
    checkActivity: () => {
      const now = Date.now();
      const inactiveTime = now - window.appState.lastActive;
      return {
        lastActive: new Date(window.appState.lastActive),
        inactiveMs: inactiveTime,
        inactiveMin: Math.floor(inactiveTime / 60000)
      };
    },
    refreshSession: async () => {
      if (window.supabase && window.supabase.auth) {
        try {
          const { data, error } = await window.supabase.auth.refreshSession();
          const success = !error && !!data.session;
          
          if (success) {
            // 更新最后刷新时间
            window.appState.lastRefreshTime = Date.now();
            // 触发会话恢复事件
            window.dispatchEvent(new Event('appresume'));
          }
          
          return success;
        } catch (e) {
          console.error('💥 刷新会话时出错:', e);
          return false;
        }
      }
      return false;
    },
    // 强制刷新页面内容
    refreshContent: () => {
      try {
        window.dispatchEvent(new Event('appresume'));
        console.log('📣 已触发内容刷新事件');
        return true;
      } catch (e) {
        console.error('❌ 触发内容刷新事件失败:', e);
        return false;
      }
    }
  };
  
  // 初始化
  function initialize() {
    if (window.appState.initialized) return;
    
    // 标记为已初始化
    window.appState.initialized = true;
    
    // 设置活动监控
    setupActivityMonitoring();
    
    // 设置无限循环保护
    setupInfiniteLoopProtection();
    
    // 设置定期刷新
    setupPeriodicRefresh();
    
    // 尝试恢复会话
    setTimeout(() => {
      restoreSession().then(success => {
        if (success) {
          console.log('✅ 应用初始化完成：会话已恢复');
        } else {
          console.log('✅ 应用初始化完成：会话未恢复');
        }
      });
    }, 1000); // 延迟1秒执行，确保其他脚本已加载
    
    console.log('✅ Capacitor应用初始化完成');
  }
  
  // 当DOM加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
  
  // 导出到全局
  window.capacitorAppInit = initialize;
})(); 