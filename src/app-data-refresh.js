// app-data-refresh.js - Android应用专用数据刷新机制
// 解决应用环境中的刷新问题和数据加载问题

(function() {
  console.log('📱 Android应用数据刷新机制初始化');
  
  // 检查是否在应用环境中
  const isAppEnvironment = () => {
    return typeof window !== 'undefined' && 
      (window.navigator.userAgent.includes('capacitor') || 
       window.navigator.userAgent.includes('android') ||
       /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
  };
  
  // 如果不是应用环境，不执行后续代码
  if (!isAppEnvironment()) {
    console.log('非应用环境，跳过应用刷新逻辑');
    return;
  }
  
  // 定义全局变量，跟踪最后一次刷新时间和刷新状态
  window.appRefreshState = {
    lastRefreshTime: Date.now(),
    isRefreshing: false,
    failedAttempts: 0,
    maxFailedAttempts: 3,
    dataLoaded: false,
    sessionRestored: false,
    isNavigating: false, // 添加导航状态跟踪
    preventRefreshUntil: 0, // 添加暂停刷新时间戳
    disableAutoRedirect: false // 禁用自动重定向
  };
  
  // 记录日志
  function logAppEvent(type, message) {
    if (!type || !message) return; // 安全检查
    
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${type}: ${message}`);
    
    // 保存日志到本地存储
    try {
      const logs = JSON.parse(localStorage.getItem('app-refresh-logs') || '[]');
      logs.unshift({ time: timestamp, type, message });
      
      // 保留最近50条日志
      while (logs.length > 50) {
        logs.pop();
      }
      
      localStorage.setItem('app-refresh-logs', JSON.stringify(logs));
    } catch (e) {
      // 忽略存储错误
    }
  }
  
  // 安全获取Supabase客户端
  function getSafeSupabaseClient() {
    if (typeof window === 'undefined') return null;
    
    try {
      // 直接检查全局对象
      if (typeof window.supabase !== 'undefined' && 
          window.supabase && 
          typeof window.supabase.auth === 'object' && 
          typeof window.supabase.from === 'function') {
        return window.supabase;
      }
      
      // 其他全局名称检查
      if (typeof window.SUPABASE !== 'undefined' && 
          window.SUPABASE && 
          typeof window.SUPABASE.auth === 'object' && 
          typeof window.SUPABASE.from === 'function') {
        return window.SUPABASE;
      }
      
      // 尝试通过全局变量获取
      for (const key in window) {
        try {
          if (window[key] && 
              typeof window[key] === 'object' && 
              typeof window[key].auth === 'object' && 
              typeof window[key].from === 'function') {
            return window[key];
          }
        } catch (err) {
          // 忽略错误，继续检查
          continue;
        }
      }
    } catch (err) {
      console.error('获取Supabase客户端出错:', err);
    }
    
    return null;
  }
  
  // 检查是否应暂停刷新
  function shouldPreventRefresh() {
    // 如果正在导航过程中，阻止刷新
    if (window.appRefreshState.isNavigating) {
      return true;
    }
    
    // 如果在暂停刷新时间段内，阻止刷新
    if (Date.now() < window.appRefreshState.preventRefreshUntil) {
      return true;
    }
    
    return false;
  }
  
  // 检查当前是否在关键页面上
  function isOnCriticalPage() {
    const path = window.location.pathname;
    
    // 登录、注册、个人中心、发帖、编辑等都是关键页面
    return (
      path.includes('/login') || 
      path.includes('/register') || 
      path.includes('/profile') || 
      path.includes('/create') || 
      path.includes('/edit') ||
      path.includes('/admin') ||
      // 检查是否有表单聚焦
      document.activeElement && 
      (document.activeElement.tagName === 'INPUT' || 
       document.activeElement.tagName === 'TEXTAREA')
    );
  }
  
  // 临时暂停刷新机制
  function pauseRefreshFor(milliseconds) {
    window.appRefreshState.preventRefreshUntil = Date.now() + milliseconds;
    logAppEvent('INFO', `刷新机制暂停${milliseconds/1000}秒`);
  }
  
  // 执行数据刷新
  function refreshAppData(force = false) {
    // 如果在关键页面上，除非强制刷新，否则不执行刷新
    if (!force && isOnCriticalPage()) {
      logAppEvent('INFO', '在关键页面上，跳过自动刷新');
      return Promise.resolve(false);
    }
    
    // 检查是否应阻止刷新
    if (shouldPreventRefresh() && !force) {
      logAppEvent('INFO', '当前正在导航或处于暂停刷新期，跳过刷新');
      return Promise.resolve(false);
    }
    
    // 避免多个刷新同时进行
    if (window.appRefreshState.isRefreshing) {
      logAppEvent('WARN', '已有刷新任务在进行中，跳过本次刷新');
      return Promise.resolve(false);
    }
    
    const now = Date.now();
    const timeSinceLastRefresh = now - window.appRefreshState.lastRefreshTime;
    
    // 增加检查间隔，从10秒改为30秒，避免频繁刷新
    if (!force && timeSinceLastRefresh < 30000) {
      logAppEvent('INFO', `刷新过于频繁，跳过(${Math.round(timeSinceLastRefresh/1000)}秒)`);
      return Promise.resolve(false);
    }
    
    logAppEvent('INFO', '开始刷新应用数据');
    window.appRefreshState.isRefreshing = true;
    window.appRefreshState.lastRefreshTime = now;
    
    // 获取Supabase客户端
    const supabase = getSafeSupabaseClient();
    
    if (!supabase) {
      logAppEvent('ERROR', 'Supabase客户端不可用，无法刷新数据');
      window.appRefreshState.isRefreshing = false;
      window.appRefreshState.failedAttempts++;
      return Promise.resolve(false);
    }
    
    // 只更新会话状态，不刷新帖子数据以减少干扰
    return supabase.auth.getSession()
      .then(result => {
        // 添加安全类型检查
        if (!result || typeof result !== 'object') {
          throw new Error('获取会话返回无效结果');
        }
        
        const { data, error } = result;
        
        if (error) {
          throw error;
        }
        
        if (data && data.session && data.session.user && data.session.user.id) {
          logAppEvent('SUCCESS', `会话刷新成功，会话ID: ${data.session.user.id.slice(0,6)}...`);
          window.appRefreshState.sessionRestored = true;
          window.appRefreshState.isRefreshing = false;
          return true;
        } else {
          logAppEvent('INFO', '无会话数据');
          window.appRefreshState.isRefreshing = false;
          return false;
        }
      })
      .catch(err => {
        logAppEvent('ERROR', `会话刷新异常: ${err.message || String(err)}`);
        window.appRefreshState.isRefreshing = false;
        return false;
      });
  }
  
  // 监听页面导航事件，减少刷新干扰
  function setupNavigationListeners() {
    // 监听特定表单提交，完全禁止刷新和重定向
    document.addEventListener('submit', (e) => {
      const form = e.target;
      
      // 检查是否是登录或发帖表单
      if (form && (
          form.action?.includes('login') || 
          form.action?.includes('register') ||
          form.action?.includes('post') ||
          form.action?.includes('create') ||
          form.action?.includes('edit') ||
          form.id === 'login-form' || 
          form.id === 'register-form' ||
          form.id === 'post-form' ||
          form.className.includes('login') ||
          form.className.includes('register') ||
          form.className.includes('post')
      )) {
        // 禁用自动重定向(很重要)
        window.appRefreshState.disableAutoRedirect = true;
        
        // 长时间暂停刷新 - 5分钟
        pauseRefreshFor(300000);
        
        logAppEvent('INFO', '检测到关键表单提交，已禁用自动重定向');
      }
    });
    
    // 通用的导航事件监听
    document.addEventListener('click', (e) => {
      // 找出所有可能触发导航的元素
      const navElement = e.target.closest('a, button, [role="button"]');
      
      if (navElement) {
        // 检查是否是关键导航(登录、注册、发帖等)
        const href = navElement.getAttribute('href') || '';
        const text = navElement.textContent?.toLowerCase() || '';
        
        const isCriticalNav = (
          href.includes('login') ||
          href.includes('register') ||
          href.includes('post') ||
          href.includes('create') ||
          href.includes('edit') ||
          href.includes('profile') ||
          text.includes('登录') ||
          text.includes('注册') ||
          text.includes('发帖') ||
          text.includes('编辑') ||
          text.includes('提交')
        );
        
        if (isCriticalNav) {
          // 对关键导航禁用自动重定向
          window.appRefreshState.disableAutoRedirect = true;
          
          // 更长时间暂停刷新 - 5分钟
          pauseRefreshFor(300000);
          
          logAppEvent('INFO', '检测到关键导航，已禁用自动重定向');
        } 
        else if (navElement.tagName === 'A' || 
                navElement.tagName === 'BUTTON' ||
                navElement.getAttribute('role') === 'button') {
          
          // 标记正在导航
          window.appRefreshState.isNavigating = true;
          
          // 普通导航暂停刷新120秒
          pauseRefreshFor(120000);
          
          // 20秒后重置导航状态
          setTimeout(() => {
            window.appRefreshState.isNavigating = false;
          }, 20000);
        }
      }
    });
  }
  
  // 触发组件刷新
  function triggerComponentsRefresh() {
    // 如果正在导航，不触发刷新
    if (window.appRefreshState.isNavigating) {
      return;
    }
    
    // 如果已禁用自动重定向，不触发任何改变
    if (window.appRefreshState.disableAutoRedirect) {
      return;
    }
    
    // 如果在关键页面上，不触发刷新
    if (isOnCriticalPage()) {
      return;
    }
    
    logAppEvent('INFO', '尝试触发组件刷新');
    
    try {
      // 触发自定义事件，通知React组件更新
      const refreshEvent = new CustomEvent('app-data-refreshed');
      window.dispatchEvent(refreshEvent);
      
      // 尝试找到主要内容元素
      const mainContent = document.querySelector('main') || document.body;
      if (mainContent) {
        // 触发DOM变化以帮助某些框架检测更改
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        tempDiv.dataset.refreshMarker = Date.now().toString();
        mainContent.appendChild(tempDiv);
        
        // 稍后移除
        setTimeout(() => {
          try {
            mainContent.removeChild(tempDiv);
          } catch (e) {
            // 忽略错误
          }
        }, 100);
      }
    } catch (e) {
      logAppEvent('ERROR', `触发刷新事件时出错: ${e.message}`);
    }
  }
  
  // 自动刷新策略
  function setupAutoRefresh() {
    // 页面加载完成后检查是否是关键页面
    window.addEventListener('load', () => {
      // 检查是否在关键页面上
      if (isOnCriticalPage()) {
        logAppEvent('INFO', '在关键页面上，禁用自动刷新');
        window.appRefreshState.disableAutoRedirect = true;
        // 长时间暂停刷新
        pauseRefreshFor(300000);
        return;
      }
      
      // 延迟5秒执行初始刷新，确保应用完全加载
      setTimeout(() => {
        refreshAppData(true);
      }, 5000);
    });
    
    // 页面从后台激活时刷新 - 延长激活间隔
    document.addEventListener('visibilitychange', () => {
      // 如果禁用了自动重定向，跳过激活刷新
      if (window.appRefreshState.disableAutoRedirect) {
        return;
      }
      
      // 如果在关键页面上，跳过激活刷新
      if (isOnCriticalPage()) {
        return;
      }
      
      if (document.visibilityState === 'visible') {
        // 检查距离上次刷新的时间
        const now = Date.now();
        const timeSinceLastRefresh = now - window.appRefreshState.lastRefreshTime;
        
        // 只有超过120秒才触发激活刷新
        if (timeSinceLastRefresh > 120000) {
          logAppEvent('INFO', '页面从后台激活且超过2分钟，刷新数据');
          refreshAppData();
        }
      }
    });
    
    // 检查输入框焦点，如果有表单交互则暂停刷新
    document.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        logAppEvent('INFO', '检测到表单输入，暂停刷新');
        pauseRefreshFor(300000); // 5分钟暂停
      }
    });
    
    // 周期性刷新但仅限于非关键页面 - 20分钟一次
    setInterval(() => {
      // 如果禁用了自动重定向或在关键页面上，跳过定时刷新
      if (window.appRefreshState.disableAutoRedirect || isOnCriticalPage()) {
        return;
      }
      
      // 只有非导航状态下才执行自动刷新
      if (!window.appRefreshState.isNavigating) {
        refreshAppData();
      }
    }, 1200000); // 20分钟刷新一次
    
    // 检测循环失败 - 5分钟一次
    setInterval(() => {
      // 如果在关键页面上，重置失败计数
      if (isOnCriticalPage()) {
        window.appRefreshState.failedAttempts = 0;
        return;
      }
      
      // 如果禁用了自动重定向，跳过检测
      if (window.appRefreshState.disableAutoRedirect) {
        return;
      }
      
      if (window.appRefreshState.failedAttempts >= window.appRefreshState.maxFailedAttempts) {
        logAppEvent('WARN', `连续${window.appRefreshState.failedAttempts}次刷新失败，强制刷新页面`);
        // 仅当不在关键页面时才强制刷新
        if (!isOnCriticalPage()) {
          window.location.reload();
        }
      }
    }, 300000); // 5分钟检查一次
  }
  
  // 添加全局刷新方法，可从其他模块调用
  window.appRefresh = {
    refresh: (force) => {
      // 如果在关键页面上且非强制，不刷新
      if (!force && (window.appRefreshState.disableAutoRedirect || isOnCriticalPage())) {
        return Promise.resolve(false);
      }
      
      // 如果强制刷新，则忽略所有限制
      return refreshAppData(force).then(success => {
        if (success && !window.appRefreshState.isNavigating && 
            !window.appRefreshState.disableAutoRedirect && 
            !isOnCriticalPage()) {
          triggerComponentsRefresh();
        }
        return success;
      });
    },
    getState: () => ({ ...window.appRefreshState }),
    pauseFor: (milliseconds) => pauseRefreshFor(milliseconds),
    disableRedirect: () => {
      window.appRefreshState.disableAutoRedirect = true;
      pauseRefreshFor(300000);
    },
    enableRedirect: () => {
      window.appRefreshState.disableAutoRedirect = false;
    },
    getLogs: () => {
      try {
        return JSON.parse(localStorage.getItem('app-refresh-logs') || '[]');
      } catch (e) {
        return [];
      }
    }
  };
  
  // 初始化导航监听器
  setupNavigationListeners();
  
  // 启动自动刷新策略
  setupAutoRefresh();
  
  logAppEvent('INFO', '应用刷新机制已彻底改进，已添加关键页面保护');
})(); 