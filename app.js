/*
 # Endpoint URL #

 https://api.github.com/legacy/repos/search/{query}

 Note: Github imposes a rate limit of 60 request per minute. Documentation can be found at http://developer.github.com/v3/.

 # Example Response JSON #

 {
 "repositories": [
 {
 "created_at": "2014-01-13T02:37:26Z",
 "description": "A Ruby interface to the TradeGecko API.",
 "followers": 1,
 "fork": false,
 "forks": 2,
 "has_downloads": true,
 "has_issues": true,
 "has_wiki": true,
 "homepage": null,
 "language": "Ruby",
 "name": "gecko",
 "open_issues": 3,
 "owner": "tradegecko",
 "private": false,
 "pushed": "2014-07-29T08:18:51Z",
 "pushed_at": "2014-07-29T08:18:51Z",
 "score": 16.24838,
 "size": 1617,
 "type": "repo",
 "url": "https://github.com/tradegecko/gecko",
 "username": "tradegecko",
 "watchers": 1
 }
 ]
 }
 */

/**
 * @param {Function} job
 * @param {Number} delay
 * @constructor
 */
var DelayedTask = function (job, delay) {

    var taskID;

    this.schedule = function () {
        if (taskID) {
            throw Error('TASK ALREADY SCHEDULED');
        } else {
            taskID = setTimeout(job, delay);
        }
    };

    this.cancel = function () {
        if (taskID) {
            clearInterval(taskID)
            taskID = null;
        }
    };
};

/**
 * @param {DelayedTask} task
 * @param {promise} promise
 * @constructor
 */
var StructuredDelayedTask = function (task, promise) {
    this.handle = task;
    this.promise = promise;
};

angular.module('SearchApp', [])
    .service('DelayedTaskFactory', ['$q', function ($q) {

        /**
         * @param {Function} job
         * @param {Number} delay
         * @returns {StructuredDelayedTask}
         */
        this.create = function (job, delay) {
            var deferred = $q.defer();
            var task = new DelayedTask(function () {
                try {
                    var result = job();
                    deferred.resolve($q.when(result));
                } catch (errorResponse) {
                    deferred.reject(errorResponse.data);
                }
            }, delay);
            return new StructuredDelayedTask(task, deferred.promise);
        };

    }])
    .service('GithubService', ['$http', 'DelayedTaskFactory', '$q', 'START_PAGE', 'PAGE_LIMIT', 'TIME_DELAY',
        function ($http, delayedTaskFactory, $q, START_PAGE, PAGE_LIMIT, TIME_DELAY) {

            /**
             * @type {string}
             */
            var TARGET_URL_PRFIX = 'https://api.github.com/legacy/repos/search/';

            var noOpFunction = function () {
            };

            /**
             * @type {DelayedTask}
             */
            var dummyDelayedTask = new DelayedTask(noOpFunction, 0);

            /**
             * @param keyword
             * @param pageNumber
             * @returns {StructuredDelayedTask}
             */
            this.searchByKeywordWithPaging = function (keyword, pageNumber) {
                if (pageNumber > PAGE_LIMIT || pageNumber < START_PAGE) {
                    return new StructuredDelayedTask(
                        dummyDelayedTask,
                        $q.reject({message: 'INVALID PAGING VALUE ' + pageNumber + ' FOR KEYWORD ' + keyword})
                    );
                } else {
                    var delayedJob = delayedTaskFactory.create(searchGitHubRepos(keyword, pageNumber), TIME_DELAY);
                    delayedJob.handle.schedule();
                    return delayedJob;
                }
            };

            /**
             * @param {string} term
             * @param {Number} targetPage
             * @returns {Function}
             */
            var searchGitHubRepos = function (term, targetPage) {
                return function () {
                    return $http.get(createGithubSearchURL(term, targetPage))
                        .then(createResultBeans)
                        .catch(function (response) {
                            return $q.reject(response.data);
                        });
                };
            };

            /**
             * @param {string} term
             * @param {Number} targetPage
             * @returns {string}
             */
            var createGithubSearchURL = function (term, targetPage) {
                return TARGET_URL_PRFIX + term + "?start_page=" + targetPage;
            };

            /**
             * @param {Object} response
             */
            var createResultBeans = function (response) {
                var rawData = response.data.repositories;
                var results = [];
                for (var i = 0, l = rawData.length; i < l; i++) {
                    results.push({
                        owner: rawData[i].owner,
                        name: rawData[i].name,
                        language: rawData[i].language,
                        followers: rawData[i].followers,
                        url: rawData[i].url,
                        description: rawData[i].description
                    });
                }
                return results;
            };

        }])
    .controller('SearchController', ['$scope', 'GithubService', 'START_PAGE', 'PAGE_LIMIT', function ($scope, githubService, START_PAGE, PAGE_LIMIT) {

        /**
         * @type {StructuredDelayedTask}
         */
        var delayedJob;

        /**
         * @type {number}
         */
        var currentPage = START_PAGE;

        /**
         * @type {Array}
         */
        $scope.searchResults = [];

        /**
         * @type {boolean}
         */
        $scope.canInitiateRequests = true;

        /**
         * @type {boolean}
         */
        $scope.fetchingMoreResults = false;

        $scope.conductSearch = function () {
            var term = getFormattedInput();
            cancelJobIfStillActive();
            resetErrorState();
            resetPaging();
            $scope.searchResults = [];
            if (term != "") {
                delayedJob = githubService.searchByKeywordWithPaging(term, currentPage);
                $scope.canInitiateRequests = false;
                $scope.fetchingMoreResults = false;
                delayedJob.promise
                    .then(onSearchResultsReceived)
                    .catch(onErrorOccurred)
                    .finally(resetRequestInitiation);
            }
        };

        var cancelJobIfStillActive = function () {
            if (delayedJob) {
                delayedJob.handle.cancel();
                delayedJob = null;
            }
        };

        $scope.fetchMoreResults = function () {
            var term = getFormattedInput();
            cancelJobIfStillActive();
            resetErrorState();
            incrementPage();
            delayedJob = githubService.searchByKeywordWithPaging(term, currentPage);
            $scope.canInitiateRequests = false;
            $scope.fetchingMoreResults = true;
            delayedJob.promise
                .then(onSearchResultsReceived)
                .catch(function (error) {
                    decrementPage();
                    onErrorOccurred(error);
                })
                .finally(resetRequestInitiation);
        };

        /**
         * @param {Array} beans
         */
        var onSearchResultsReceived = function (beans) {
            if (beans.length == 0) {
                disableLoadMore();
            } else {
                $scope.searchResults.push.apply($scope.searchResults, beans);
            }
        };

        /**
         * @param {Object} error
         * @param {boolean} keepTerm
         */
        var onErrorOccurred = function (error) {
            $scope.error = error;
        };

        var disableLoadMore = function () {
            $scope.canLoadMore = false;
        };

        /**
         * @returns {string}
         */
        var getFormattedInput = function () {
            return $scope.searchTerm.split(' ').join('+');
        };

        var resetErrorState = function () {
            $scope.error = null;
        };

        var resetPaging = function () {
            currentPage = START_PAGE;
            $scope.canLoadMore = true;
        };

        var incrementPage = function () {
            currentPage++;
        };

        var decrementPage = function () {
            currentPage--;
        };

        var resetRequestInitiation = function () {
            $scope.canInitiateRequests = true;
            $scope.fetchingMoreResults = false;
        };

        /**
         * @returns {boolean}
         */
        $scope.isAllowedToLoadMore = function () {
            return $scope.canLoadMore === true &&
                getFormattedInput() != "" &&
                currentPage <= PAGE_LIMIT &&
                $scope.canInitiateRequests === true &&
                $scope.searchResults.length > 0;
        };

    }])
    .value('PAGE_LIMIT', 10)
    .value('START_PAGE', 1)
    .value('TIME_DELAY', 2000)
    .config(['$httpProvider', function ($httpProvider) {
        $httpProvider.defaults.useXDomain = true;
        delete $httpProvider.defaults.headers.common['X-Requested-With'];
    }]);
